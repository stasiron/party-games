import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { GoogleAuthProvider, linkWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { set, get, update, runTransaction } from '../lib/rtdb';
import { db, firebaseConnection, getPartyOrigin, PI_AP_GATEWAY } from '../lib/firebase';
import { auth as firebaseAuth, firestore } from '../lib/firebase/client';
import gameData from '../data/gameContent.json';
import GuestPlayersPanel from '../components/GuestPlayersPanel';
import { isGuestPlayer } from '../lib/guestPlayers';
import ConnectionStatus from '../components/ConnectionStatus';
import IosWifiHelp from '../components/IosWifiHelp';
import { useServerBusy } from '../context/useServerBusy';
import { useLongPress } from '../hooks/useLongPress';
import {
    isLowPowerDevice,
    getJoinGraceMs,
    getPresenceMissingGraceMs,
    getPlayersDebounceMs,
} from '../lib/lowPower';
import { buildGameIndex, buildActiveRoomsFromPublic } from './utils/activeRooms';
import '../styles/app.css';

const NeverHaveIEver = lazy(() => import('../games/never-have-i-ever/NeverHaveIEver'));
const Impostor = lazy(() => import('../games/impostor/Impostor'));
const TruthOrDare = lazy(() => import('../games/truth-or-dare/TruthOrDare'));
const Mafia = lazy(() => import('../games/mafia/Mafia'));
const DarkStories = lazy(() => import('../games/dark-stories/DarkStories'));

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const ORPHAN_ROOM_TTL_MS = 10 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const ROOM_CLEANUP_COOLDOWN_MS = 30 * 1000;
const STALE_PRESENCE_MS = 3 * 60 * 1000;
const BACKGROUND_CLEANUP_INTERVAL_MS = 2 * 60 * 1000;
const CLEANUP_LEASE_PATH = '_maintenance/roomsCleanupLease';
const CLEANUP_LEASE_TTL_MS = 3 * 60 * 1000;
const ROOMS_PUBLIC_SYNC_COOLDOWN_MS = 2000;
const PRESENCE_INDEX_ROOT = 'playerPresenceByAuthUid';
const RATE_LIMITS_MS = {
    join: 1800,
    createRoom: 1200,
    kick: 1200,
    adminDestructive: 3500,
    adminMutation: 1200,
};
const UI_SETTINGS_KEY = 'partyGames.uiSettings.v1';
const NICKNAME_KEY = 'partyGames.nickname.v1';
const LAST_ROOM_KEY = 'partyGames.lastRoomId.v1';

function loadUiSettings() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function loadLocalNickname() {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(NICKNAME_KEY) || '';
}

function loadLastRoomId() {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(LAST_ROOM_KEY) || '';
}

function isPlayerActive(player, now) {
    if (!player || player.isKicked === true || player.isOnline === false) return false;
    const lastSeenAt = Number(player.lastSeenAt || player.joinedAt || 0);
    if (!lastSeenAt) return false;
    return (now - lastSeenAt) <= STALE_PRESENCE_MS;
}

function countActivePlayers(playersMap, now = Date.now()) {
    return Object.values(playersMap || {}).reduce((acc, player) => (
        acc + (isPlayerActive(player, now) ? 1 : 0)
    ), 0);
}

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[idx];
    }
    return code;
}

const themePresets = [
    { id: 'default', label: 'Fioletowy (domyślny)', stops: ['#0a0f1e', '#2a113a', '#8c215e'] },
    { id: 'sunrise', label: 'Żółto-zielono-niebieski', stops: ['#f8ff70', '#3ad59f', '#0099ff'] },
    { id: 'sunset', label: 'Różowo-pomarańczowy', stops: ['#ff5f6d', '#ffb56b', '#ffd47f'] },
    { id: 'forest', label: 'Zielono-granatowy', stops: ['#1b5e20', '#0d3b66', '#1e88e5'] },
];

function App() {
    const { runWithBusy } = useServerBusy();
    const [selectedGame, setSelectedGame] = useState(null); // roomId
    const [selectedGameType, setSelectedGameType] = useState(null);
    const [entryRole, setEntryRole] = useState(null);
    const [manualRoomCode, setManualRoomCode] = useState('');
    const [activeRooms, setActiveRooms] = useState([]);
    const [playerName, setPlayerName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [nameError, setNameError] = useState('');
    const [joinStatus, setJoinStatus] = useState('');
    const [lastJoinResult, setLastJoinResult] = useState('');

    const [playersList, setPlayersList] = useState([]);
    const [myPlayerId, setMyPlayerId] = useState(null);

    const [isRoomLocked, setIsRoomLocked] = useState(false);

    const [lobbyMessage, setLobbyMessage] = useState(''); // Komunikat o wyrzuceniu widoczny w lobby
    const isLeavingVoluntarily = useRef(false);           // Odróżnia wyjście gracza od wyrzucenia przez Hosta

    // STANY: Dla tajnego panelu administratora pod logo
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showAccountCenter, setShowAccountCenter] = useState(false);
    const [accountEmail, setAccountEmail] = useState('');
    const [accountNickname, setAccountNickname] = useState(() => loadLocalNickname());
    const [lastKnownRoomId, setLastKnownRoomId] = useState(() => loadLastRoomId());
    const [authUser, setAuthUser] = useState(null);
    const [authBusy, setAuthBusy] = useState(false);
    const [authStatus, setAuthStatus] = useState('');
    const [nicknameSavedAt, setNicknameSavedAt] = useState(0);
    const [themePreset, setThemePreset] = useState(() => loadUiSettings()?.themePreset || 'default');
    const [soundEnabled, setSoundEnabled] = useState(() => {
        const stored = loadUiSettings();
        if (typeof stored?.soundEnabled === 'boolean') return stored.soundEnabled;
        return !isLowPowerDevice();
    });
    const [vibrationEnabled, setVibrationEnabled] = useState(() => {
        const stored = loadUiSettings();
        if (typeof stored?.vibrationEnabled === 'boolean') return stored.vibrationEnabled;
        return !isLowPowerDevice();
    });
    const [showConnectionFooter, setShowConnectionFooter] = useState(() => {
        const stored = loadUiSettings();
        if (typeof stored?.showConnectionFooter === 'boolean') return stored.showConnectionFooter;
        return false;
    });
    const [adminCommand, setAdminCommand] = useState('');
    const [isAdminMode, setIsAdminMode] = useState(false);
    const [adminBypassEnabled, setAdminBypassEnabled] = useState(false);
    const toggleAdminPanel = useCallback(() => {
        setShowAdminPanel((prev) => !prev);
    }, []);
    const logoLongPress = useLongPress(toggleAdminPanel, { delayMs: 650 });
    const prevPlayersCountRef = useRef(0);
    const isHostRef = useRef(isHost);
    const soundEnabledRef = useRef(soundEnabled);
    const isJoinedRef = useRef(isJoined);
    const myPlayerIdRef = useRef(myPlayerId);
    const joinGraceUntilRef = useRef(0);
    const missingPlayerSinceRef = useRef(0);
    const isJoiningRef = useRef(false);
    const isOnlineHealSentRef = useRef(false);
    const lastOnlineHealAtRef = useRef(0);
    const lastZombieCleanupAtRef = useRef(0);
    const lastRoomsCleanupAtRef = useRef(0);
    const lastRoomPublicSyncAtRef = useRef(0);
    const cachedRoomRef = useRef({ players: null, isLocked: false, updatedAt: 0 });
    const lastSavedUiSettingsRef = useRef('');
    const actionRateRef = useRef(new Map());

    const runRoomsCleanup = useCallback(async (rawRooms, now = Date.now()) => {
        const raw = rawRooms || {};
        const cleanupUpdates = {};

        Object.entries(raw).forEach(([roomId, room]) => {
            if (!room?.gameId) return;
            const playersEntries = Object.entries(room.players || {});
            const activePlayers = [];

            playersEntries.forEach(([playerId, player]) => {
                if (!player || player.isKicked === true) return;
                if (isPlayerActive(player, now)) {
                    activePlayers.push(player);
                    return;
                }
                // Usuń duchy online/offline, które nie odświeżały presence.
                cleanupUpdates[`rooms/${roomId}/players/${playerId}`] = null;
                if (player.authUid) {
                    cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                }
            });

            const hasActiveHost = activePlayers.some((player) => player.isHost === true);
            const ageMs = Math.max(0, now - Number(room.createdAt || 0));
            const isEmptyTooLong = activePlayers.length === 0 && ageMs >= EMPTY_ROOM_TTL_MS;
            const isOrphanTooLong = !hasActiveHost && ageMs >= ORPHAN_ROOM_TTL_MS;

            if (isEmptyTooLong || isOrphanTooLong) {
                cleanupUpdates[`rooms/${roomId}`] = null;
                cleanupUpdates[`roomsPublic/${roomId}`] = null;
                playersEntries.forEach(([, player]) => {
                    if (player?.authUid) {
                        cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                    }
                });
            }
        });

        if (Object.keys(cleanupUpdates).length === 0) return;
        lastRoomsCleanupAtRef.current = now;
        await update(ref(db), cleanupUpdates);
    }, []);

    const cleanupOrphanRoomsPublic = useCallback(async (rawRoomsPublic, rawRooms) => {
        const publicEntries = Object.entries(rawRoomsPublic || {});
        if (publicEntries.length === 0) return;
        const roomIds = new Set(Object.keys(rawRooms || {}));
        const orphanUpdates = {};
        for (const [roomId] of publicEntries) {
            if (!roomIds.has(roomId)) {
                orphanUpdates[`roomsPublic/${roomId}`] = null;
            }
        }
        if (Object.keys(orphanUpdates).length === 0) return;
        await update(ref(db), orphanUpdates);
    }, []);

    const syncRoomPublicSummary = useCallback((roomId, gameId, playersMap, isLocked) => {
        if (!roomId || !gameId) return;
        if (isLeavingVoluntarily.current) return;
        const now = Date.now();
        if (now - lastRoomPublicSyncAtRef.current < ROOMS_PUBLIC_SYNC_COOLDOWN_MS) return;
        lastRoomPublicSyncAtRef.current = now;
        const onlineCount = countActivePlayers(playersMap, now);
        void update(ref(db), {
            [`roomsPublic/${roomId}`]: {
                gameId,
                isLocked: isLocked === true,
                onlineCount,
                updatedAt: now,
            },
        }).catch(() => {
            /* best effort room public sync */
        });
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
            setAuthUser(user);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!authUser?.uid) return;
        let active = true;

        const loadNickname = async () => {
            try {
                const snap = await getDoc(doc(firestore, 'users', authUser.uid));
                if (!active || !snap.exists()) return;
                const nick = String(snap.data()?.nickname || '').trim();
                if (nick) {
                    setAccountNickname(nick);
                    window.localStorage.setItem(NICKNAME_KEY, nick);
                }
            } catch {
                // Nickname loading is best-effort only.
            }
        };

        void loadNickname();
        return () => {
            active = false;
        };
    }, [authUser]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nextSettings = {
            themePreset,
            soundEnabled,
            vibrationEnabled,
            showConnectionFooter,
        };
        const serialized = JSON.stringify(nextSettings);
        if (serialized === lastSavedUiSettingsRef.current) return;

        const timeoutId = window.setTimeout(() => {
            try {
                window.localStorage.setItem(UI_SETTINGS_KEY, serialized);
                lastSavedUiSettingsRef.current = serialized;
            } catch {
                // Ignore storage quota/private mode errors.
            }
        }, 350);

        return () => window.clearTimeout(timeoutId);
    }, [themePreset, soundEnabled, vibrationEnabled, showConnectionFooter]);

    useEffect(() => {
        if (!accountNickname.trim()) return;
        if (playerName.trim()) return;
        const timeoutId = window.setTimeout(() => {
            setPlayerName(accountNickname.trim());
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [accountNickname, playerName]);

    useEffect(() => {
        isHostRef.current = isHost;
        soundEnabledRef.current = soundEnabled;
        isJoinedRef.current = isJoined;
        myPlayerIdRef.current = myPlayerId;
    }, [isHost, soundEnabled, isJoined, myPlayerId]);

    const playJoinSound = useCallback(() => {
        if (!soundEnabled || typeof window === 'undefined') return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            const mainOsc = ctx.createOscillator();
            const mainGain = ctx.createGain();
            mainOsc.type = 'sine';
            mainOsc.frequency.value = 340;
            mainOsc.connect(mainGain);

            const delay = ctx.createDelay(0.5);
            const feedbackGain = ctx.createGain();
            const delayOutGain = ctx.createGain();
            delay.connect(feedbackGain);
            feedbackGain.connect(delay);
            delay.connect(delayOutGain);
            delayOutGain.connect(ctx.destination);

            mainGain.connect(ctx.destination);
            mainGain.connect(delay);

            mainGain.gain.setValueAtTime(0.0001, ctx.currentTime);
            mainGain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
            mainGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

            delay.delayTime.value = 0.09;
            feedbackGain.gain.value = 0.35;
            delayOutGain.gain.value = 0.28;

            mainOsc.start();

            const shimmerOsc = ctx.createOscillator();
            const shimmerGain = ctx.createGain();
            shimmerOsc.type = 'sine';
            shimmerOsc.frequency.value = 280;
            shimmerOsc.connect(shimmerGain);
            shimmerGain.connect(ctx.destination);
            shimmerGain.gain.setValueAtTime(0.0001, ctx.currentTime + 0.05);
            shimmerGain.gain.exponentialRampToValueAtTime(0.015, ctx.currentTime + 0.08);
            shimmerGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
            shimmerOsc.start(ctx.currentTime + 0.05);

            setTimeout(() => {
                try {
                    mainOsc.stop();
                    shimmerOsc.stop();
                    ctx.close();
                } catch {
                    /* WebAudio cleanup */
                }
            }, 420);
        } catch {
            /* brak WebAudio / polityka autoplay */
        }
    }, [soundEnabled]);

    const gameById = useMemo(() => buildGameIndex(gameData.games), []);
    const currentGameMeta = useMemo(
        () => (selectedGameType ? gameById.get(selectedGameType) || null : null),
        [selectedGameType, gameById]
    );

    const leaveToLobby = useCallback((options = {}) => {
        const { message = '', keepEntryRole = true } = options;
        isLeavingVoluntarily.current = true;
        joinGraceUntilRef.current = 0;
        missingPlayerSinceRef.current = 0;
        isJoiningRef.current = false;
        cachedRoomRef.current = { players: null, isLocked: false, updatedAt: 0 };
        setSelectedGame(null);
        setSelectedGameType(null);
        setIsJoined(false);
        setIsHost(false);
        setMyPlayerId(null);
        setPlayersList([]);
        setNameError('');
        setJoinStatus('');
        setLastJoinResult('');
        setPlayerName(accountNickname.trim());
        if (message) setLobbyMessage(message);
        if (!keepEntryRole) setEntryRole(null);
        if (typeof window !== 'undefined') {
            try {
                const url = new URL(window.location.href);
                if (url.searchParams.has('room')) {
                    url.searchParams.delete('room');
                    window.history.replaceState({}, '', url.toString());
                }
            } catch {
                /* ignore URL cleanup */
            }
        }
        window.setTimeout(() => {
            isLeavingVoluntarily.current = false;
        }, 600);
    }, [accountNickname]);

    const updatePresenceIndex = useCallback(async (uid, roomId, playerId) => {
        if (!uid) return;
        await set(ref(db, `${PRESENCE_INDEX_ROOT}/${uid}`), {
            roomId: roomId || '',
            playerId: playerId || '',
            updatedAt: Date.now(),
        });
    }, []);

    const clearPresenceIndex = useCallback(async (uid) => {
        if (!uid) return;
        await set(ref(db, `${PRESENCE_INDEX_ROOT}/${uid}`), null);
    }, []);

    const isRateLimited = useCallback((key, cooldownMs) => {
        const now = Date.now();
        const last = Number(actionRateRef.current.get(key) || 0);
        if (now - last < cooldownMs) return true;
        actionRateRef.current.set(key, now);
        return false;
    }, []);

    /** Host z bazy (nie tylko przełącznik w lobby) — od tego zależy kick i zamykanie pokoju. */
    const effectiveIsHost = useMemo(() => {
        if (!isJoined || !myPlayerId) return isHost;
        const me = playersList.find((p) => p.id === myPlayerId);
        if (!me) return isHost;
        return me.isHost === true && me.isOnline !== false;
    }, [isJoined, myPlayerId, playersList, isHost]);

    /** Pełny adres z parametrem `room` — QR i kopiowanie (kanoniczny origin na Malinie). */
    const roomInviteUrl = useMemo(() => {
        if (!selectedGame || !isJoined || !effectiveIsHost || typeof window === 'undefined') return '';
        try {
            const base = getPartyOrigin() || window.location.origin;
            const u = new URL(base);
            u.searchParams.set('room', selectedGame);
            u.hash = '';
            return u.toString();
        } catch {
            return '';
        }
    }, [selectedGame, isJoined, effectiveIsHost]);

    // Wejście z linku / QR: ?room=<roomId>
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = (params.get('room') || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        if (!roomFromUrl) return;
        const t = setTimeout(async () => {
            const roomSnap = await get(ref(db, `rooms/${roomFromUrl}`));
            const roomData = roomSnap.val();
            if (!roomData?.gameId) {
                setLobbyMessage('❌ Ten pokój nie istnieje lub został zamknięty.');
                return;
            }
            setEntryRole('guest');
            setSelectedGame(roomFromUrl);
            setSelectedGameType(roomData.gameId);
            setLobbyMessage('');
            setShowAdminPanel(false);
        }, 0);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const preset = themePresets.find((preset) => preset.id === themePreset) || themePresets[0];
        const root = document.documentElement;
        root.style.setProperty('--bg-gradient-start', preset.stops[0]);
        root.style.setProperty('--bg-gradient-middle', preset.stops[1]);
        root.style.setProperty('--bg-gradient-end', preset.stops[2]);
    }, [themePreset]);

    useEffect(() => {
        if (!selectedGame || selectedGameType) return;
        let active = true;
        const loadRoomType = async () => {
            try {
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val();
                if (!active) return;
                if (!roomData?.gameId) {
                    setLobbyMessage('❌ Pokój nie istnieje albo został zamknięty.');
                    setSelectedGame(null);
                    setSelectedGameType(null);
                    return;
                }
                setSelectedGameType(roomData.gameId);
            } catch {
                if (!active) return;
                setLobbyMessage('❌ Nie udało się wczytać pokoju. Spróbuj ponownie.');
                setSelectedGame(null);
                setSelectedGameType(null);
            }
        };
        loadRoomType();
        return () => {
            active = false;
        };
    }, [selectedGame, selectedGameType]);

    // =========================================================================
    // POPRAWIONY EFEKT 1: NASŁUCHIWANIE GRACZY, SYSTEM ISKICKED I AUTOMATYCZNA CZYSTKA POKOJU
    // =========================================================================
    useEffect(() => {
        if (!selectedGame) return;

        let playersTimeoutId;
        let lastPlayersJson = '';

        const applyPlayersSnapshot = (data) => {
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                players: data,
                updatedAt: Date.now(),
            };
            const playersArray = Object.keys(data)
                .map((key) => ({
                    id: key,
                    ...data[key],
                }))
                .filter((p) => !p.isKicked);
            setPlayersList(playersArray);

            try {
                const newCount = playersArray.length;
                const prevCount = prevPlayersCountRef.current || 0;
                if (isHostRef.current && soundEnabledRef.current && prevCount > 0 && newCount > prevCount) {
                    playJoinSound();
                }
                prevPlayersCountRef.current = newCount;
            } catch {
                /* join sound */
            }

            if (isHostRef.current && selectedGameType && !isLeavingVoluntarily.current) {
                syncRoomPublicSummary(selectedGame, selectedGameType, data, cachedRoomRef.current.isLocked);
            }
        };

        const handlePresenceAndKick = (data) => {
            if (!isJoinedRef.current || !myPlayerIdRef.current || isJoiningRef.current) return;
            const pid = myPlayerIdRef.current;
            const myData = data[pid];

            if (myData?.isKicked) {
                missingPlayerSinceRef.current = 0;
                onDisconnect(ref(db, `rooms/${selectedGame}/players/${pid}`)).cancel();
                const kickedRoomId = selectedGame;
                const kickMessage = isLeavingVoluntarily.current
                    ? ''
                    : '⚠️ Zostałeś wyrzucony z pokoju przez Hosta.';
                leaveToLobby({ message: kickMessage, keepEntryRole: true });
                void remove(ref(db, `rooms/${kickedRoomId}/players/${pid}`));
                if (authUser?.uid) {
                    void clearPresenceIndex(authUser.uid);
                }
                return;
            }

            if (!myData) {
                if (!missingPlayerSinceRef.current) {
                    missingPlayerSinceRef.current = Date.now();
                }
                const missingFor = Date.now() - missingPlayerSinceRef.current;
                const pastJoinGrace = Date.now() > joinGraceUntilRef.current;
                const pastMissingGrace = missingFor >= getPresenceMissingGraceMs();
                if (
                    pastJoinGrace &&
                    pastMissingGrace &&
                    !isLeavingVoluntarily.current
                ) {
                    leaveToLobby({
                        message: '⚠️ Utracono połączenie z pokojem. Dołącz ponownie.',
                        keepEntryRole: true,
                    });
                }
                return;
            }

            missingPlayerSinceRef.current = 0;

            if (myData.isOnline === false) {
                const now = Date.now();
                const healCooldownMs = 5000;
                if (!isOnlineHealSentRef.current && now - lastOnlineHealAtRef.current >= healCooldownMs) {
                    isOnlineHealSentRef.current = true;
                    lastOnlineHealAtRef.current = now;
                    set(ref(db, `rooms/${selectedGame}/players/${pid}/isOnline`), true);
                }
            } else {
                isOnlineHealSentRef.current = false;
            }
            setIsHost(myData.isHost || false);
        };

        const playersDebounceMs = getPlayersDebounceMs();

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const unsubscribe = onValue(playersRef, (snapshot) => {
            let data = snapshot.val() || {};

            if (isHostRef.current) {
                const zombieKeys = Object.keys(data).filter((key) => {
                    const p = data[key];
                    if (!p) return false;
                    if (p.isGuest === true) return false;
                    if (String(p.name || '').trim()) return false;
                    if (p.isOnline === true) return false;
                    return true;
                });
                if (zombieKeys.length > 0) {
                    const now = Date.now();
                    if (now - lastZombieCleanupAtRef.current >= 3000) {
                        lastZombieCleanupAtRef.current = now;
                        const updates = {};
                        zombieKeys.forEach((key) => {
                            updates[`rooms/${selectedGame}/players/${key}`] = null;
                        });
                        update(ref(db), updates);
                    }
                    data = { ...data };
                    zombieKeys.forEach((k) => {
                        delete data[k];
                    });
                }
            }

            const json = JSON.stringify(data);
            if (json === lastPlayersJson) return;
            lastPlayersJson = json;

            clearTimeout(playersTimeoutId);
            playersTimeoutId = setTimeout(() => {
                handlePresenceAndKick(data);
                applyPlayersSnapshot(data);
            }, playersDebounceMs);
        });

        const lockedRef = ref(db, `rooms/${selectedGame}/isLocked`);
        const unsubscribeLocked = onValue(lockedRef, (snapshot) => {
            const locked = snapshot.val() || false;
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                isLocked: locked,
                updatedAt: Date.now(),
            };
            setIsRoomLocked(locked);
            if (isHostRef.current && selectedGameType && !isLeavingVoluntarily.current) {
                syncRoomPublicSummary(selectedGame, selectedGameType, cachedRoomRef.current.players || {}, locked);
            }
        });

        const roomGameIdRef = ref(db, `rooms/${selectedGame}/gameId`);
        const unsubscribeRoomRoot = onValue(roomGameIdRef, (snapshot) => {
            if (snapshot.exists()) return;
            if (!isJoinedRef.current || isLeavingVoluntarily.current) return;
            if (Date.now() < joinGraceUntilRef.current) return;
            leaveToLobby({
                message: '⚠️ Host zamknął pokój. Wrócono do ekranu wyboru.',
                keepEntryRole: true,
            });
        });

        return () => {
            clearTimeout(playersTimeoutId);
            unsubscribe();
            unsubscribeLocked();
            unsubscribeRoomRoot();
        };
    }, [selectedGame, selectedGameType, playJoinSound, leaveToLobby, syncRoomPublicSummary, authUser, clearPresenceIndex]);

    useEffect(() => {
        if (!isJoined || typeof document === 'undefined') return undefined;
        const onVisibility = () => {
            if (document.hidden) {
                joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [isJoined]);

    useEffect(() => {
        if (!isJoined || !selectedGame || !myPlayerId) return undefined;
        const playerRef = ref(db, `rooms/${selectedGame}/players/${myPlayerId}`);

        const touchPresence = () => {
            update(playerRef, { isOnline: true, lastSeenAt: Date.now() }).catch(() => {
                /* best effort heartbeat */
            });
        };

        touchPresence();
        const intervalId = window.setInterval(touchPresence, 90 * 1000);
        return () => window.clearInterval(intervalId);
    }, [isJoined, selectedGame, myPlayerId]);

    // Menu główne gościa: roomsPublic + filtr po istniejących rooms (bez „duchów” po zamknięciu)
    useEffect(() => {
        if (selectedGame || entryRole !== 'guest') return;
        let publicRaw = {};
        let existingRoomIds = new Set();

        const recomputeGuestRooms = () => {
            const filteredPublic = {};
            const orphanUpdates = {};
            for (const [roomId, room] of Object.entries(publicRaw)) {
                if (!existingRoomIds.has(roomId)) {
                    orphanUpdates[`roomsPublic/${roomId}`] = null;
                    continue;
                }
                filteredPublic[roomId] = room;
            }
            if (Object.keys(orphanUpdates).length > 0) {
                void update(ref(db), orphanUpdates).catch(() => {
                    /* best effort orphan cleanup */
                });
            }
            const list = buildActiveRoomsFromPublic(filteredPublic, gameById);
            setActiveRooms(list);
        };

        const unsubPublic = onValue(ref(db, 'roomsPublic'), (snapshot) => {
            publicRaw = snapshot.val() || {};
            recomputeGuestRooms();
        });
        const unsubRooms = onValue(ref(db, 'rooms'), (snapshot) => {
            const raw = snapshot.val() || {};
            existingRoomIds = new Set(Object.keys(raw));
            recomputeGuestRooms();
        });

        return () => {
            unsubPublic();
            unsubRooms();
            setActiveRooms([]);
        };
    }, [selectedGame, entryRole, gameById]);

    useEffect(() => {
        if (!selectedGame || !effectiveIsHost || !isJoined) return undefined;
        let cancelled = false;
        const leaseOwner = `${selectedGame}:${myPlayerId || 'host'}`;

        const tryCleanupNow = async () => {
            const leaseRef = ref(db, CLEANUP_LEASE_PATH);
            const now = Date.now();
            const leaseResult = await runTransaction(leaseRef, (current) => {
                const currentOwner = String(current?.owner || '');
                const expiresAt = Number(current?.expiresAt || 0);
                const leaseExpired = expiresAt <= now;
                const sameOwner = currentOwner === leaseOwner;
                if (!current || leaseExpired || sameOwner) {
                    return {
                        owner: leaseOwner,
                        expiresAt: now + CLEANUP_LEASE_TTL_MS,
                        updatedAt: now,
                    };
                }
                return undefined;
            }, { applyLocally: false });
            if (!leaseResult.committed || leaseResult.snapshot.val()?.owner !== leaseOwner) return;
            if (now - lastRoomsCleanupAtRef.current < ROOM_CLEANUP_COOLDOWN_MS) return;
            try {
                const [roomsSnap, publicSnap] = await Promise.all([
                    get(ref(db, 'rooms')),
                    get(ref(db, 'roomsPublic')),
                ]);
                if (cancelled) return;
                const raw = roomsSnap.val() || {};
                const publicRaw = publicSnap.val() || {};
                await runRoomsCleanup(raw, now);
                await cleanupOrphanRoomsPublic(publicRaw, raw);
            } catch {
                /* best effort background cleanup */
            }
        };

        void tryCleanupNow();
        const intervalId = window.setInterval(() => {
            void tryCleanupNow();
        }, BACKGROUND_CLEANUP_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [selectedGame, effectiveIsHost, isJoined, myPlayerId, runRoomsCleanup, cleanupOrphanRoomsPublic]);

    // 4. OBSŁUGA TAJNYCH KOMEND ADMINISTRATORA pod logo
    const handleAdminCommand = useCallback(async () => {
        const rawCmd = adminCommand.trim();
        const cleanedCmd = rawCmd.toUpperCase();

        if (cleanedCmd === '') return;

        await runWithBusy(async () => {
        try {
            if (['RESET', 'PURGE', 'PURGE PLAYERS', 'PURGE ROOMS', 'CLEAR'].includes(cleanedCmd)) {
                if (isRateLimited('admin:destructive', RATE_LIMITS_MS.adminDestructive)) {
                    setLobbyMessage('⏱️ Za szybko. Odczekaj chwilę przed kolejną komendą destrukcyjną.');
                    return;
                }
            }
            if (
                cleanedCmd === 'REVEAL' ||
                cleanedCmd === 'HOST' ||
                cleanedCmd.startsWith('HOST ') ||
                cleanedCmd.startsWith('ADMIN ')
            ) {
                if (isRateLimited('admin:mutation', RATE_LIMITS_MS.adminMutation)) {
                    setLobbyMessage('⏱️ Za szybko. Odczekaj chwilę przed kolejną komendą admina.');
                    return;
                }
            }

            if (cleanedCmd === 'CLEAR') {
                if (!selectedGame) {
                    alert('❌ CLEAR działa wewnątrz pokoju.');
                    return;
                }
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val() || {};
                if (!roomData.gameId) {
                    alert('❌ Nie znaleziono pokoju do czyszczenia.');
                    return;
                }
                const now = Date.now();
                await update(ref(db), {
                    [`rooms/${selectedGame}`]: {
                        gameId: roomData.gameId,
                        isLocked: false,
                        createdAt: roomData.createdAt || now,
                        gameState: null,
                        settings: null,
                        roleHistory: null,
                        players: null,
                    },
                    [`roomsPublic/${selectedGame}`]: {
                        gameId: roomData.gameId,
                        isLocked: false,
                        onlineCount: 0,
                        updatedAt: now,
                    },
                });
                setLobbyMessage(`🧹 Konsola: Wyczyszczono pokój ${selectedGame} (bez usuwania).`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd === 'RESET') {
                if (window.confirm('⚠️ RESET usunie wszystkie pokoje i graczy. Kontynuować?')) {
                    await update(ref(db), {
                        rooms: null,
                        roomsPublic: null,
                    });
                    setSelectedGame(null);
                    setSelectedGameType(null);
                    setEntryRole(null);
                    setManualRoomCode('');
                    setActiveRooms([]);
                    setPlayersList([]);
                    setIsJoined(false);
                    setIsHost(false);
                    setMyPlayerId(null);
                    setNameError('');
                    setJoinStatus('');
                    setLastJoinResult('');
                    setLobbyMessage('🧹 Konsola: RESET zakończony. Wszystko wyczyszczone.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            if (cleanedCmd === 'PURGE') {
                if (window.confirm('⚠️ PURGE rozłączy wszystkich graczy i usunie wszystkie pokoje. Kontynuować?')) {
                    await update(ref(db), {
                        rooms: null,
                        roomsPublic: null,
                    });
                    setSelectedGame(null);
                    setSelectedGameType(null);
                    setEntryRole(null);
                    setManualRoomCode('');
                    setActiveRooms([]);
                    setPlayersList([]);
                    setIsJoined(false);
                    setIsHost(false);
                    setMyPlayerId(null);
                    setNameError('');
                    setJoinStatus('');
                    setLastJoinResult('');
                    setLobbyMessage('🧹 Konsola: PURGE zakończony. Wszystkie pokoje usunięte, gracze rozłączeni.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            if (cleanedCmd === 'PURGE PLAYERS') {
                if (window.confirm('⚠️ PURGE PLAYERS rozłączy wszystkich graczy, ale zostawi pokoje. Kontynuować?')) {
                    const roomsSnap = await get(ref(db, 'rooms'));
                    const roomsData = roomsSnap.val() || {};
                    const purgePlayersUpdates = {};

                    Object.keys(roomsData).forEach((roomId) => {
                        purgePlayersUpdates[`rooms/${roomId}/players`] = null;
                    });

                    if (Object.keys(purgePlayersUpdates).length > 0) {
                        await update(ref(db), purgePlayersUpdates);
                    }

                    setPlayersList([]);
                    setIsJoined(false);
                    setIsHost(false);
                    setMyPlayerId(null);
                    setNameError('');
                    setJoinStatus('');
                    setLastJoinResult('');
                    setLobbyMessage('🧹 Konsola: PURGE PLAYERS zakończony. Wszyscy gracze rozłączeni, pokoje zostawione.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            if (cleanedCmd === 'PURGE ROOMS') {
                if (window.confirm('⚠️ PURGE ROOMS usunie wszystkie pokoje. Kontynuować?')) {
                    await update(ref(db), {
                        rooms: null,
                        roomsPublic: null,
                    });
                    setSelectedGame(null);
                    setSelectedGameType(null);
                    setEntryRole(null);
                    setManualRoomCode('');
                    setActiveRooms([]);
                    setPlayersList([]);
                    setIsJoined(false);
                    setIsHost(false);
                    setMyPlayerId(null);
                    setNameError('');
                    setJoinStatus('');
                    setLastJoinResult('');
                    setLobbyMessage('🧹 Konsola: PURGE ROOMS zakończony. Wszystkie pokoje usunięte.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            // ADMIN shortcuts: 'ADMIN' toggles admin mode, or 'ADMIN KICK <name>' to target
            if (cleanedCmd === 'ADMIN') {
                const newState = !isAdminMode;
                setIsAdminMode(newState);
                setLobbyMessage(`🔧 Konsola: Tryb ADMIN ${newState ? 'włączony' : 'wyłączony'}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd === 'BYPASS') {
                const next = !adminBypassEnabled;
                setAdminBypassEnabled(next);
                if (next) setIsAdminMode(true);
                setLobbyMessage(`🛡️ Konsola: BYPASS ${next ? 'włączony' : 'wyłączony'}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd === 'REVEAL') {
                if (!selectedGame) {
                    alert('❌ REVEAL działa tylko wewnątrz pokoju.');
                    return;
                }
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val() || {};
                if (!['impostor', 'mafia'].includes(roomData.gameId)) {
                    alert('❌ REVEAL działa tylko w grze Impostor lub Mafia.');
                    return;
                }
                await update(ref(db, `rooms/${selectedGame}/gameState`), {
                    revealAllRoles: true,
                });
                setLobbyMessage('👁️ Konsola: Ujawniono role graczy.');
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd === 'HELP') {
                setLobbyMessage(
                    'Komendy: RESET, PURGE, PURGE PLAYERS, PURGE ROOMS, CLEAR, ADMIN, BYPASS, REVEAL, ADMIN KICK <name>, HOST / HOST ME / HOST <name>.'
                );
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd.startsWith('ADMIN ')) {
                if (!selectedGame) {
                    alert('❌ Komenda ADMIN wymaga wybranego pokoju.');
                    return;
                }
                const sub = rawCmd.slice(6).trim(); // keep case for names
                if (sub.toUpperCase().startsWith('KICK ')) {
                    const targetName = sub.slice(5).trim();
                    if (!targetName) {
                        alert('❌ Podaj nazwę gracza do wyrzucenia: ADMIN KICK <name>');
                        return;
                    }
                    const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                    const data = snap.val() || {};
                    const targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === targetName.toLowerCase());
                    if (!targetKey) {
                        alert('❌ Nie znaleziono gracza o podanej nazwie w tym pokoju.');
                        return;
                    }
                    const target = data[targetKey];
                    // Admin wyrzuca natychmiast, niezależnie od stanu isOnline
                    await remove(ref(db, `rooms/${selectedGame}/players/${targetKey}`));
                    setLobbyMessage(`🧹 Konsola: Wyrzucono gracza ${target.name || targetKey} z pokoju.`);
                    setAdminCommand('');
                    setShowAdminPanel(false);
                    return;
                }
                alert('❌ Nieznana podkomenda ADMIN. Użyj: ADMIN KICK <name>');
                return;
            }

            // HOST transfer: HOST <name> or HOST ME or simple HOST -> make caller host
            if (cleanedCmd === 'HOST') {
                if (!selectedGame) {
                    alert('❌ Komenda HOST wymaga wybranego pokoju.');
                    return;
                }
                if (!myPlayerId) {
                    alert('❌ Musisz być graczem w pokoju, aby stać się Hosta. Dołącz najpierw.');
                    return;
                }
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};
                if (!data[myPlayerId]) {
                    alert('❌ Twój gracz nie istnieje w tym pokoju.');
                    return;
                }
                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${myPlayerId}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(`🔁 Konsola: Przekazano rolę Hosta do ${data[myPlayerId]?.name || myPlayerId}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            // HOST transfer: HOST <name> or HOST ME
            if (cleanedCmd.startsWith('HOST')) {
                if (!selectedGame) {
                    alert('❌ Komenda HOST wymaga wybranego pokoju.');
                    return;
                }
                const arg = rawCmd.split(/\s+/).slice(1).join(' ').trim();
                if (!arg) {
                    alert('❌ Użycie: HOST <name> lub HOST ME');
                    return;
                }
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};

                let targetKey = null;
                if (arg.toUpperCase() === 'ME') {
                    if (!myPlayerId) {
                        alert('❌ Nie jesteś graczem w tym pokoju. Wpisz nazwę gracza lub dołącz zanim użyjesz HOST ME.');
                        return;
                    }
                    targetKey = myPlayerId;
                } else {
                    targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === arg.toLowerCase());
                    if (!targetKey) {
                        alert('❌ Nie znaleziono gracza o podanej nazwie w tym pokoju.');
                        return;
                    }
                }

                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${targetKey}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(`🔁 Konsola: Przekazano rolę Hosta do ${data[targetKey]?.name || targetKey}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            alert('❌ Nieznana komenda administratora.');
        } catch (e) {
            console.error(e);
            alert('❌ Błąd podczas wykonywania komendy. Sprawdź konsolę.');
        }
        });
    }, [adminCommand, selectedGame, myPlayerId, isAdminMode, adminBypassEnabled, runWithBusy, isRateLimited]);

    // 5. DOŁĄCZANIE DO POKOJU (NADPISYWANIE DUCHÓW / ZABEZPIECZENIEM PRZED BLOKADĄ)
    const handleJoin = async () => {
        if (isRateLimited('join', RATE_LIMITS_MS.join)) {
            setNameError('⏱️ Za szybkie ponowne dołączenie. Odczekaj chwilę.');
            return;
        }
        const joinStartedAt = performance.now();
        isLeavingVoluntarily.current = false; //
        setLobbyMessage('');
        setJoinStatus('');
        const currentAuthUid = authUser?.uid || null;
        const cleanedName = playerName.trim();
        if (cleanedName === '') {
            setNameError('Podaj imię, aby wejść do pokoju.');
            return;
        }

        await runWithBusy(async () => {
        setJoinStatus('Łączenie z pokojem...');
        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        let data = cachedRoomRef.current.players;
        let isLocked = cachedRoomRef.current.isLocked;

        if (currentAuthUid) {
            const previousPresenceSnap = await get(ref(db, `${PRESENCE_INDEX_ROOT}/${currentAuthUid}`));
            const previousPresence = previousPresenceSnap.val();
            const previousRoomId = String(previousPresence?.roomId || '');
            const previousPlayerId = String(previousPresence?.playerId || '');
            if (previousRoomId && previousPlayerId) {
                await set(ref(db, `rooms/${previousRoomId}/players/${previousPlayerId}`), null);
                data = null;
                cachedRoomRef.current = { players: null, isLocked: false, updatedAt: 0 };
            }
        }

        if (!data || Date.now() - cachedRoomRef.current.updatedAt > 1500) {
            setJoinStatus('Pobieranie stanu pokoju...');
            const [playersSnap, lockedSnap] = await Promise.all([
                get(ref(db, `rooms/${selectedGame}/players`)),
                get(ref(db, `rooms/${selectedGame}/isLocked`)),
            ]);
            data = playersSnap.val() || {};
            isLocked = lockedSnap.val() || false;
            cachedRoomRef.current = {
                players: data,
                isLocked,
                updatedAt: Date.now(),
            };
        }

        let existingPlayerKey = null;
        if (currentAuthUid) {
            existingPlayerKey = Object.keys(data).find(
                (key) => data[key]?.authUid === currentAuthUid
            );
        }
        if (!existingPlayerKey) {
            existingPlayerKey = Object.keys(data).find(
                (key) => data[key].name?.toLowerCase() === cleanedName.toLowerCase()
            );
        }

        if (isLocked && !existingPlayerKey) {
            setNameError('🔒 Ten pokój został zablokowany przez Hosta. Rozgrywka już trwa!');
            return;
        }

        let targetPlayerRef;
        let finalIsHost = isHost;

        if (existingPlayerKey) {
            const existingPlayer = data[existingPlayerKey];
            const isSameAccount = currentAuthUid && existingPlayer.authUid === currentAuthUid;

            if (existingPlayer.isKicked) {
                setNameError('Ta nazwa należy do wyrzuconego gracza. Wybierz inną.');
                return;
            }

            if (existingPlayer.isGuest) {
                setNameError(
                    'Ta nazwa należy do gościa bez telefonu. Host może zmienić nazwę w panelu gości.'
                );
                return;
            }

            if (existingPlayer.isOnline !== false && !isSameAccount) {
                setNameError(
                    'Ta nazwa jest już zajęta przez aktywnego gracza. Wybierz inną lub poczekaj, aż gracz się rozłączy (💤).'
                );
                return;
            }

            targetPlayerRef = ref(db, `rooms/${selectedGame}/players/${existingPlayerKey}`);
            myPlayerIdRef.current = existingPlayerKey;
            setMyPlayerId(existingPlayerKey);
            finalIsHost = !!existingPlayer.isHost;
            setIsHost(finalIsHost);
        } else {
            const newPlayerRef = push(playersRef);
            targetPlayerRef = newPlayerRef;
            myPlayerIdRef.current = newPlayerRef.key;
            setMyPlayerId(newPlayerRef.key);
            if (isHost) {
                await update(ref(db), {
                    [`rooms/${selectedGame}/players/${newPlayerRef.key}`]: {
                        name: cleanedName,
                        authUid: currentAuthUid,
                        isHost: true,
                        isOnline: true,
                        isKicked: false,
                        joinedAt: Date.now(),
                        lastSeenAt: Date.now(),
                    },
                    [`rooms/${selectedGame}/gameState`]: null,
                }, { priority: true });
                isJoinedRef.current = true;
                setIsJoined(true);
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem(LAST_ROOM_KEY, selectedGame);
                    setLastKnownRoomId(selectedGame);
                }
                setNameError('');
                joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
                const elapsed = Math.round(performance.now() - joinStartedAt);
                setLastJoinResult(`Ostatnie wejście: ${elapsed} ms`);
                setJoinStatus('');
                try {
                    onDisconnect(targetPlayerRef).update({ isOnline: false });
                } catch (discErr) {
                    console.warn('[join] onDisconnect:', discErr);
                }
                if (currentAuthUid) {
                    await updatePresenceIndex(currentAuthUid, selectedGame, newPlayerRef.key);
                }
                isJoiningRef.current = false;
                return;
            }
        }

        joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
        missingPlayerSinceRef.current = 0;
        isJoiningRef.current = true;

        try {
            setJoinStatus('Zapisywanie gracza...');
            await set(targetPlayerRef, {
                name: cleanedName,
                authUid: currentAuthUid,
                isHost: finalIsHost,
                isOnline: true,
                isKicked: false,
                joinedAt: Date.now(),
                lastSeenAt: Date.now(),
            }, { priority: true });

            setJoinStatus('Weryfikacja wejścia...');
            const verify = await get(targetPlayerRef);
            if (!verify.val()?.name) {
                setNameError('Nie udało się zapisać w pokoju. Spróbuj ponownie.');
                setLastJoinResult('Błąd wejścia — spróbuj ponownie.');
                return;
            }

            try {
                onDisconnect(targetPlayerRef).update({ isOnline: false });
            } catch (discErr) {
                console.warn('[join] onDisconnect:', discErr);
            }
            if (currentAuthUid) {
                const joinedPlayerId = targetPlayerRef.key || existingPlayerKey;
                await updatePresenceIndex(currentAuthUid, selectedGame, joinedPlayerId);
            }

            isJoinedRef.current = true;
            setIsJoined(true);
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(LAST_ROOM_KEY, selectedGame);
                setLastKnownRoomId(selectedGame);
            }
            setNameError('');
            joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
            const elapsed = Math.round(performance.now() - joinStartedAt);
            setLastJoinResult(`Ostatnie wejście: ${elapsed} ms`);
            setJoinStatus('');
        } catch (err) {
            console.error(err);
            joinGraceUntilRef.current = 0;
            setNameError('Nie udało się dołączyć. Sprawdź połączenie z bazą (na dole ekranu).');
            setLastJoinResult('Błąd wejścia — sprawdź połączenie.');
            setJoinStatus('');
        } finally {
            isJoiningRef.current = false;
        }
        });
    };

    const openRoomAsGuest = useCallback(async (roomId) => {
        const normalizedRoomId = String(roomId || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        if (!normalizedRoomId) return;
        const roomSnap = await get(ref(db, `rooms/${normalizedRoomId}`));
        const roomData = roomSnap.val();
        if (!roomData?.gameId) {
            setLobbyMessage('❌ Ten pokój nie istnieje lub został zamknięty.');
            return;
        }
        setEntryRole('guest');
        setSelectedGame(normalizedRoomId);
        setSelectedGameType(roomData.gameId);
        setIsHost(false);
        setIsJoined(false);
        setMyPlayerId(null);
        setLobbyMessage('');
    }, []);

    const handleJoinLastKnownGame = useCallback(async () => {
        const roomId = lastKnownRoomId.trim();
        if (!roomId) {
            setAuthStatus('Brak zapisanej gry do wznowienia.');
            return;
        }
        try {
            await openRoomAsGuest(roomId);
            setShowAccountCenter(false);
            setAuthStatus('');
        } catch {
            setAuthStatus('Nie udało się dołączyć do ostatniej gry.');
        }
    }, [lastKnownRoomId, openRoomAsGuest]);

    const createHostRoom = useCallback(async (gameId) => {
        if (isRateLimited('create-room', RATE_LIMITS_MS.createRoom)) {
            setLobbyMessage('⏱️ Tworzysz pokoje zbyt szybko. Odczekaj chwilę.');
            return;
        }
        await runWithBusy(async () => {
            let roomCode = generateRoomCode();
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const existsSnap = await get(ref(db, `rooms/${roomCode}`));
                if (!existsSnap.exists()) break;
                roomCode = generateRoomCode();
            }
            const finalExistsSnap = await get(ref(db, `rooms/${roomCode}`));
            if (finalExistsSnap.exists()) {
                setLobbyMessage('❌ Nie udało się utworzyć kodu pokoju. Spróbuj ponownie.');
                return;
            }
            const now = Date.now();
            await update(ref(db), {
                [`rooms/${roomCode}`]: {
                    gameId,
                    isLocked: false,
                    createdAt: now,
                    gameState: null,
                    settings: null,
                },
                [`roomsPublic/${roomCode}`]: {
                    gameId,
                    isLocked: false,
                    onlineCount: 0,
                    updatedAt: now,
                },
            });
            setEntryRole('host');
            setSelectedGame(roomCode);
            setSelectedGameType(gameId);
            setIsHost(true);
            setLobbyMessage('');
        });
    }, [runWithBusy, isRateLimited]);

    const kickPlayer = useCallback(async (playerId) => {
        if (!selectedGame || !myPlayerId) return;
        if (isRateLimited(`kick:${selectedGame}`, RATE_LIMITS_MS.kick)) {
            setLobbyMessage('⏱️ Za szybkie kolejne wyrzucenie gracza.');
            return;
        }
        await runWithBusy(async () => {
            try {
                const meSnap = await get(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
                if (!meSnap.val()?.isHost) {
                    alert('❌ Tylko aktywny Host może wyrzucać graczy. Odśwież stronę lub użyj HOST ME w konsoli.');
                    return;
                }
                const targetRef = ref(db, `rooms/${selectedGame}/players/${playerId}`);
                const targetSnap = await get(targetRef);
                const target = targetSnap.val();
                if (!target) return;
                if (target.isHost) {
                    alert('❌ Nie możesz wyrzucić Hosta.');
                    return;
                }

                await update(targetRef, { isKicked: true, isOnline: false });

                if (target.isOnline === false) {
                    await remove(targetRef);
                } else {
                    window.setTimeout(async () => {
                        try {
                            const again = await get(targetRef);
                            if (again.val()?.isKicked) await remove(targetRef);
                        } catch {
                            /* backup cleanup */
                        }
                    }, 3000);
                }
                if (target.authUid) {
                    await clearPresenceIndex(target.authUid);
                }

                setLobbyMessage(`🧹 Host: Wyrzucono ${target.name || 'gracza'} z pokoju.`);
            } catch (err) {
                console.error(err);
                alert('❌ Błąd przy wyrzucaniu gracza. Sprawdź połączenie z bazą (na dole ekranu).');
            }
        });
    }, [selectedGame, myPlayerId, runWithBusy, clearPresenceIndex, isRateLimited]);

    const adminKick = useCallback(async (gameId, playerKey) => {
        if (isRateLimited(`admin-kick:${gameId}`, RATE_LIMITS_MS.adminMutation)) {
            setLobbyMessage('⏱️ Za szybkie kolejne wyrzucenie przez admina.');
            return;
        }
        try {
            const snap = await get(ref(db, `rooms/${gameId}/players/${playerKey}`));
            const p = snap.val();
            if (!p) {
                alert('❌ Nie znaleziono gracza.');
                return;
            }
            // Admin powinien móc usunąć dowolnego gracza natychmiast
            await remove(ref(db, `rooms/${gameId}/players/${playerKey}`));
            if (p.authUid) {
                await clearPresenceIndex(p.authUid);
            }
            setLobbyMessage(`🧹 Konsola: Admin wyrzucił ${p.name || playerKey} z pokoju ${gameId}.`);
        } catch (e) {
            console.error(e);
            alert('❌ Błąd przy wyrzucaniu gracza.');
        }
    }, [clearPresenceIndex, isRateLimited]);

    const adminDeleteRoom = useCallback(async (roomId) => {
        await runWithBusy(async () => {
            try {
                await update(ref(db), {
                    [`rooms/${roomId}`]: null,
                    [`roomsPublic/${roomId}`]: null,
                });
                setLobbyMessage(`🧹 Konsola: Usunięto pokój ${roomId}.`);
            } catch (e) {
                console.error(e);
                alert('❌ Błąd przy usuwaniu pokoju.');
            }
        });
    }, [runWithBusy]);

    const handleBackToMenu = useCallback(() => {
        const roomId = selectedGame;
        const playerId = myPlayerId;
        isLeavingVoluntarily.current = true;
        if (playerId && roomId) {
            remove(ref(db, `rooms/${roomId}/players/${playerId}`));
        }
        if (authUser?.uid) {
            void clearPresenceIndex(authUser.uid);
        }
        leaveToLobby({ keepEntryRole: true });
    }, [myPlayerId, selectedGame, authUser, clearPresenceIndex, leaveToLobby]);

    const handleCloseRoom = useCallback(async () => {
        if (!selectedGame || !myPlayerId) {
            handleBackToMenu();
            return;
        }
        isLeavingVoluntarily.current = true;
        const closingRoomId = selectedGame;
        await runWithBusy(async () => {
            try {
                const playersSnap = await get(ref(db, `rooms/${closingRoomId}/players`));
                const playersData = playersSnap.val() || {};
                const closeUpdates = {
                    [`rooms/${closingRoomId}`]: null,
                    [`roomsPublic/${closingRoomId}`]: null,
                };
                Object.keys(playersData).forEach((playerId) => {
                    if (playerId === myPlayerId) return;
                    const authUid = playersData[playerId]?.authUid;
                    if (authUid) {
                        closeUpdates[`${PRESENCE_INDEX_ROOT}/${authUid}`] = null;
                    }
                });
                await update(ref(db), closeUpdates);
            } catch (err) {
                console.error(err);
                setLobbyMessage('❌ Nie udało się zamknąć pokoju. Spróbuj ponownie.');
            } finally {
                if (authUser?.uid) {
                    void clearPresenceIndex(authUser.uid);
                }
                leaveToLobby({ keepEntryRole: true });
            }
        });
    }, [selectedGame, myPlayerId, runWithBusy, authUser, clearPresenceIndex, leaveToLobby]);

    const handleLeaveRoom = useCallback(() => {
        if (effectiveIsHost) {
            handleCloseRoom();
            return;
        }
        handleBackToMenu();
    }, [effectiveIsHost, handleCloseRoom, handleBackToMenu]);

    const hasGoogleProvider = !!authUser?.providerData?.some((provider) => provider.providerId === 'google.com');
    const hasEmailProvider = !!authUser?.providerData?.some((provider) => provider.providerId === 'password');

    const handleGoogleAuth = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../services/auth/firebaseAuth');
            await authModule.signInWithGoogle();
            setAuthStatus('Zalogowano przez Google.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Logowanie Google nie powiodło się.');
        } finally {
            setAuthBusy(false);
        }
    }, []);

    const handleSendMagicLink = useCallback(async () => {
        const email = accountEmail.trim();
        if (!email) {
            setAuthStatus('Podaj email do linku logowania.');
            return;
        }
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../services/auth/firebaseAuth');
            await authModule.sendPasswordlessSignInLink(email);
            setAuthStatus('Wysłano link logowania na email.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się wysłać linku.');
        } finally {
            setAuthBusy(false);
        }
    }, [accountEmail]);

    const handleCompleteMagicLink = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../services/auth/firebaseAuth');
            await authModule.completePasswordlessSignIn(accountEmail);
            setAuthStatus('Konto połączone przez email link.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się dokończyć logowania.');
        } finally {
            setAuthBusy(false);
        }
    }, [accountEmail]);

    const handleConnectGoogle = useCallback(async () => {
        if (!firebaseAuth.currentUser) {
            setAuthStatus('Najpierw zaloguj się lub utwórz konto.');
            return;
        }
        setAuthBusy(true);
        setAuthStatus('');
        try {
            await linkWithPopup(firebaseAuth.currentUser, new GoogleAuthProvider());
            setAuthStatus('Połączono konto z Google.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się połączyć konta.');
        } finally {
            setAuthBusy(false);
        }
    }, []);

    const handleSignOut = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            await signOut(firebaseAuth);
            setAuthStatus('Wylogowano.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się wylogować.');
        } finally {
            setAuthBusy(false);
        }
    }, []);

    const handleSaveNickname = useCallback(async () => {
        const nickname = accountNickname.trim().slice(0, 24);
        if (!nickname) {
            setAuthStatus('Nick nie może być pusty.');
            return;
        }

        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(NICKNAME_KEY, nickname);
            }
            setNicknameSavedAt(Date.now());
        } catch {
            // Ignore local storage failures.
        }

        setAuthBusy(true);
        setAuthStatus('');
        try {
            if (firebaseAuth.currentUser?.uid) {
                await setDoc(
                    doc(firestore, 'users', firebaseAuth.currentUser.uid),
                    { nickname },
                    { merge: true }
                );
                setAuthStatus('Zapisano stały nick.');
            } else {
                setAuthStatus('Nick zapisany lokalnie (zaloguj się, aby zsynchronizować).');
            }
            setPlayerName((prev) => (prev.trim() ? prev : nickname));
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się zapisać nicku.');
        } finally {
            setAuthBusy(false);
        }
    }, [accountNickname]);

    useEffect(() => {
        if (!nicknameSavedAt) return undefined;
        const timer = window.setTimeout(() => {
            setNicknameSavedAt(0);
        }, 2500);
        return () => window.clearTimeout(timer);
    }, [nicknameSavedAt]);


    return (
        <div className="app-container">
            {/* Logo z obsługą double click (Easter egg panelu admina) */}
            <h1
                onDoubleClick={toggleAdminPanel}
                className="main-logo-clickable"
                title="Przytrzymaj 0,6 s (telefon) lub kliknij dwukrotnie — konsola admina"
                {...logoLongPress}
            >
                Party Games
            </h1>

            <IosWifiHelp />

            {firebaseConnection.mode === 'emulator' && (
                <div className="party-ap-banner" role="alert">
                    {firebaseConnection.onPartyGateway ? (
                        <>
                            Jesteś na <strong>{PI_AP_GATEWAY}</strong> — dobrze. Goście: Wi‑Fi{' '}
                            <strong>PartBox-Gry</strong>, ten sam adres w przeglądarce.
                        </>
                    ) : (
                        <>
                            Impreza: Wi‑Fi <strong>PartBox-Gry</strong> i{' '}
                            <a href={`http://${PI_AP_GATEWAY}`}>http://{PI_AP_GATEWAY}</a> u wszystkich
                            (nie mieszaj z IP w LAN).
                        </>
                    )}
                </div>
            )}

            <button
                type="button"
                className="account-trigger"
                onClick={() => {
                    setShowAccountCenter((prev) => !prev);
                    setShowSettings(false);
                }}
                aria-label="Otwórz centrum konta"
            >
                👤
            </button>

            <button
                type="button"
                className="settings-trigger"
                onClick={() => {
                    setShowSettings((prev) => !prev);
                    setShowAccountCenter(false);
                }}
                aria-label="Otwórz ustawienia"
            >
                ⚙
            </button>

            {showAccountCenter && (
                <div className="account-panel" role="dialog" aria-label="Centrum konta">
                    <div className="settings-panel__header">
                        <h2>Centrum konta</h2>
                        <button
                            type="button"
                            className="settings-close"
                            onClick={() => setShowAccountCenter(false)}
                            aria-label="Zamknij centrum konta"
                        >
                            ✕
                        </button>
                    </div>

                    <p className="account-status-line">
                        {authUser?.email ? `Zalogowany: ${authUser.email}` : 'Brak aktywnego konta'}
                    </p>

                    {!hasEmailProvider && (
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={handleGoogleAuth}
                            disabled={authBusy}
                        >
                            <span>Utwórz / Zaloguj przez Google</span>
                            <span className="settings-toggle__icon on">G</span>
                        </button>
                    )}

                    <div className="settings-panel__group">
                        <label className="settings-panel__label" htmlFor="account-nickname-input">
                            Stały nick
                        </label>
                        <input
                            id="account-nickname-input"
                            type="text"
                            value={accountNickname}
                            onChange={(event) => setAccountNickname(event.target.value)}
                            maxLength={24}
                            placeholder="Twój stały nick"
                            className="account-input"
                        />
                        <button
                            type="button"
                            className="btn-link"
                            onClick={handleSaveNickname}
                            disabled={authBusy}
                        >
                            Zapisz nick
                        </button>
                        {nicknameSavedAt > 0 && <p className="account-success">Nick zapisany.</p>}
                    </div>

                    {!hasGoogleProvider && (
                        <div className="settings-panel__group">
                            <label className="settings-panel__label" htmlFor="account-email-input">
                                Email (link logowania)
                            </label>
                            <input
                                id="account-email-input"
                                type="email"
                                value={accountEmail}
                                onChange={(event) => setAccountEmail(event.target.value)}
                                placeholder="twoj@email.com"
                                className="account-input"
                            />
                            <div className="account-actions-row">
                                <button type="button" className="btn-link" onClick={handleSendMagicLink} disabled={authBusy}>
                                    Wyślij link
                                </button>
                                <button type="button" className="btn-link" onClick={handleCompleteMagicLink} disabled={authBusy}>
                                    Dokończ link
                                </button>
                            </div>
                        </div>
                    )}

                    {!!lastKnownRoomId && !isJoined && (
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={handleJoinLastKnownGame}
                            disabled={authBusy}
                        >
                            <span>Dołącz do gry ({lastKnownRoomId})</span>
                            <span className="settings-toggle__icon on">▶</span>
                        </button>
                    )}

                    <button
                        type="button"
                        className="settings-toggle"
                        onClick={handleConnectGoogle}
                        disabled={authBusy}
                    >
                        <span>Połącz konto z Google</span>
                        <span className="settings-toggle__icon on">+</span>
                    </button>

                    {authUser && (
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={handleSignOut}
                            disabled={authBusy}
                        >
                            <span>Wyloguj</span>
                            <span className="settings-toggle__icon off">↩</span>
                        </button>
                    )}

                    {authStatus && <p className="settings-hint settings-hint--tight">{authStatus}</p>}
                </div>
            )}

            {showSettings && (
                <div className="settings-panel" role="dialog" aria-label="Ustawienia aplikacji">
                    <div className="settings-panel__header">
                        <h2>Ustawienia</h2>
                        <button
                            type="button"
                            className="settings-close"
                            onClick={() => setShowSettings(false)}
                            aria-label="Zamknij ustawienia"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <div className="settings-panel__label">Gradient tła</div>
                        <div className="settings-presets">
                            {themePresets.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`settings-preset ${themePreset === preset.id ? 'active' : ''}`}
                                    onClick={() => setThemePreset(preset.id)}
                                    aria-label={preset.label}
                                    aria-pressed={themePreset === preset.id}
                                    style={{
                                        backgroundImage: `linear-gradient(135deg, ${preset.stops[0]} 0%, ${preset.stops[1]} 50%, ${preset.stops[2]} 100%)`
                                    }}
                                >
                                    <span className="sr-only">{preset.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => setSoundEnabled((prev) => !prev)}
                            aria-pressed={soundEnabled}
                        >
                            <span>Dźwięk aplikacji</span>
                            <span className={`settings-toggle__icon ${soundEnabled ? 'on' : 'off'}`}>
                                {soundEnabled ? '✔' : '✕'}
                            </span>
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => setVibrationEnabled((prev) => !prev)}
                            aria-pressed={vibrationEnabled}
                        >
                            <span>Wibracje</span>
                            <span className={`settings-toggle__icon ${vibrationEnabled ? 'on' : 'off'}`}>
                                {vibrationEnabled ? '✔' : '✕'}
                            </span>
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => setShowConnectionFooter((prev) => !prev)}
                            aria-pressed={showConnectionFooter}
                        >
                            <span>Stopka statusu połączenia</span>
                            <span className={`settings-toggle__icon ${showConnectionFooter ? 'on' : 'off'}`}>
                                {showConnectionFooter ? '✔' : '✕'}
                            </span>
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => {
                                toggleAdminPanel();
                                setShowSettings(false);
                            }}
                            aria-pressed={showAdminPanel}
                        >
                            <span>Konsola administratora</span>
                            <span className={`settings-toggle__icon ${showAdminPanel ? 'on' : 'off'}`}>
                                {showAdminPanel ? '✔' : '✕'}
                            </span>
                        </button>
                        <p className="settings-hint settings-hint--tight">
                            Komendy: HELP, RESET, PURGE, PURGE PLAYERS, PURGE ROOMS, CLEAR, ADMIN, BYPASS, REVEAL… Albo przytrzymaj logo „Party Games” ~0,6 s.
                        </p>
                    </div>

                    <p className="settings-hint">
                        {isLowPowerDevice()
                            ? 'Malinka: tryb oszczędny. Na iPhonie wyłącz prywatny adres Wi‑Fi dla PartBox-Gry.'
                            : 'Internet: pełne animacje i efekty.'}
                    </p>
                </div>
            )}

            {lobbyMessage && <p className="error-message">{lobbyMessage}</p>}

            {/* PANEL DEWELOPERSKI */}
            {showAdminPanel && (
                <div className="admin-panel-container">
                    <input
                        type="text"
                        value={adminCommand}
                        onChange={(e) => setAdminCommand(e.target.value)}
                        placeholder="Konsola:"
                        onKeyDown={(e) => e.key === 'Enter' && handleAdminCommand()}
                        className="input-admin-console"
                    />
                </div>
            )}

            {!selectedGame ? (
                <div>
                    {!entryRole && (
                        <>
                            <p>Jak chcesz wejść do platformy?</p>
                            <div className="actions-stack">
                                <button onClick={() => setEntryRole('host')} className="entry-role-btn entry-role-btn--host">
                                    Jestem Hostem
                                </button>
                                <button onClick={() => setEntryRole('guest')} className="entry-role-btn entry-role-btn--guest">Jestem Gościem</button>
                            </div>
                        </>
                    )}

                    {entryRole === 'host' && (
                        <>
                            <p>Wybierz tryb gry. Utworzymy nowy pokój.</p>
                            <div className="games-grid">
                                {gameData.games.map((game) => (
                                    <button key={game.id} onClick={() => createHostRoom(game.id)}>
                                        <span className="game-title">{game.name}</span>
                                        <span className="game-desc">{game.description}</span>
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => setEntryRole(null)} className="btn-link">Wróć</button>
                        </>
                    )}

                    {entryRole === 'guest' && (
                        <>
                            <p>Wybierz aktywny pokój albo wpisz kod/link od Hosta.</p>
                            <input
                                type="text"
                                value={manualRoomCode}
                                onChange={(e) => setManualRoomCode(
                                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                                )}
                                placeholder="Kod pokoju (roomId)"
                                maxLength={ROOM_CODE_LENGTH}
                            />
                            <div className="actions-stack join-code-actions">
                                <button
                                    onClick={() => openRoomAsGuest(manualRoomCode.trim())}
                                    disabled={manualRoomCode.trim() === ''}
                                >
                                    Dołącz po kodzie
                                </button>
                            </div>
                            <div className="games-grid">
                                {activeRooms.map((room) => (
                                    <div key={room.roomId}>
                                        <button onClick={() => openRoomAsGuest(room.roomId)}>
                                            <span className="game-title">{room.gameName}</span>
                                            <span className="game-desc">
                                                Pokój: {room.roomId} · Gracze online: {room.onlineCount}
                                                {room.isLocked ? ' · 🔒' : ''}
                                            </span>
                                        </button>
                                        {isAdminMode && (
                                            <button
                                                type="button"
                                                className="btn-admin-kick"
                                                onClick={() => adminDeleteRoom(room.roomId)}
                                                title={`Admin: usuń pokój ${room.roomId}`}
                                            >
                                                🧹 Usuń pokój
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {activeRooms.length === 0 && (
                                <p className="join-progress">Brak aktywnych pokoi. Poproś Hosta o link lub kod QR.</p>
                            )}
                            <button onClick={() => setEntryRole(null)} className="btn-link">Wróć</button>
                        </>
                    )}
                </div>
            ) : (
                <div>
                    {!selectedGameType ? (
                        <div className="content-panel content-panel--dark">
                            <p>Ładowanie pokoju…</p>
                            <div className="actions-stack">
                                <button onClick={handleBackToMenu} className="btn-link">Wróć</button>
                            </div>
                        </div>
                    ) : (
                        <>
                    {!isJoined ? (
                        <div>
                            <h2>Pokój: {currentGameMeta?.name}</h2>
                            <p>Wpisz swoje imię, aby wejść:</p>
                            <input
                                type="text"
                                value={playerName}
                                onChange={(e) => {
                                    setPlayerName(e.target.value);
                                    setNameError('');
                                }}
                                placeholder="Twoje imię..."
                                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                                className={nameError ? 'input-error' : ''}
                                required
                                aria-invalid={nameError ? 'true' : 'false'}
                            />

                            {nameError && <p className="error-message">{nameError}</p>}
                            {joinStatus && <p className="join-progress">{joinStatus}</p>}
                            {lastJoinResult && !nameError && <p className="join-progress">{lastJoinResult}</p>}

                            <div className="actions-stack">
                                <button onClick={handleJoin} disabled={playerName.trim() === ''}>Wejdź do pokoju</button>
                                <button onClick={handleBackToMenu} className="btn-link">Wróć</button>
                            </div>

                            
                        </div>
                    ) : (
                        <div>
                            <h2>Grasz w: {currentGameMeta?.name}</h2>

                            {effectiveIsHost && (
                                <div className="room-lock-container">
                                    <button
                                        onClick={() => set(ref(db, `rooms/${selectedGame}/isLocked`), !isRoomLocked)}
                                        className={`btn-lock-toggle ${isRoomLocked ? 'locked' : 'unlocked'}`}
                                    >
                                        {isRoomLocked ? '🔒 Pokój zablokowany (Kliknij by zmienić)' : '🔓 Pokój odblokowany (Kliknij by zmienić)'}
                                    </button>
                                </div>
                            )}

                            <Suspense fallback={<p className="game-loading">Ładowanie gry…</p>}>
                                {selectedGameType === 'never-have-i-ever' && (
                                    <NeverHaveIEver isHost={effectiveIsHost} onLeave={handleLeaveRoom} roomInviteUrl={roomInviteUrl} roomId={selectedGame} />
                                )}

                                {selectedGameType === 'truth-or-dare' && (
                                    <TruthOrDare
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        playerName={playerName}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        roomInviteUrl={roomInviteUrl}
                                        vibrationEnabled={vibrationEnabled}
                                        roomId={selectedGame}
                                    />
                                )}

                                {selectedGameType === 'impostor' && (
                                    <Impostor
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        onCloseRoom={handleCloseRoom}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        roomInviteUrl={roomInviteUrl}
                                        isRoomLocked={isRoomLocked}
                                        roomId={selectedGame}
                                    />
                                )}

                                {selectedGameType === 'mafia' && (
                                    <Mafia
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        roomInviteUrl={roomInviteUrl}
                                        isRoomLocked={isRoomLocked}
                                        roomId={selectedGame}
                                    />
                                )}

                                {selectedGameType === 'dark-stories' && (
                                    <DarkStories isHost={effectiveIsHost} onLeave={handleLeaveRoom} roomInviteUrl={roomInviteUrl} roomId={selectedGame} />
                                )}
                            </Suspense>
                        </div>
                    )}

                    {isJoined && effectiveIsHost && (
                        <GuestPlayersPanel
                            roomId={selectedGame}
                            playersList={playersList}
                            myPlayerId={myPlayerId}
                            runWithBusy={runWithBusy}
                        />
                    )}

                    {/* SEKCJA LISTY GRACZY W POKOJU */}
                    <div className="players-section">
                        <h3>Gracze przy stole:</h3>
                        <div className="players-list">
                            {playersList.length > 0 ? playersList.map(p => (
                                <span
                                    key={p.id}
                                    className={`player-tag ${p.isOnline === false && !isGuestPlayer(p) ? 'player-offline' : ''} ${isGuestPlayer(p) ? 'player-guest' : ''}`}
                                >
                                    {p.name}
                                    {isGuestPlayer(p) && ' 📵'}
                                    {p.isOnline === false && !isGuestPlayer(p) && ' 💤'}

                                    {(isJoined && effectiveIsHost && p.id !== myPlayerId) && (
                                        <button
                                            type="button"
                                            onClick={() => kickPlayer(p.id)}
                                            className="btn-kick"
                                            title={`Wyrzuć gracza ${p.name}`}
                                        >
                                            ✕
                                        </button>
                                    )}

                                    {isAdminMode && p.id && (
                                        <button
                                            onClick={() => adminKick(selectedGame, p.id)}
                                            className="btn-admin-kick"
                                            title="Admin: wyrzuć gracza"
                                        >
                                            🛑
                                        </button>
                                    )}
                                </span>
                            )) : <span className="empty-room-text">Pusty pokój...</span>}
                        </div>
                    </div>
                        </>
                    )}
                </div>
            )}

            {showConnectionFooter && <ConnectionStatus />}
        </div>
    );
}

export default App;