import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { GoogleAuthProvider, linkWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { set, get, update, runTransaction } from '../lib/rtdb';
import { db, firebaseConnection, getPartyOrigin, PI_AP_GATEWAY } from '../lib/firebase';
import { auth as firebaseAuth, firestore } from '../lib/firebase/client';
import gameData from '../data/gameContent.js';
import { resolveGameId, isPlayableGameId } from '../data/gameIds.js';
import { getComingSoonMessage, isGameComingSoon } from '../lib/gameCatalog.js';
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
import {
    isPlayerActive,
    shouldRemoveInactivePlayer,
    countActivePlayers,
    findRoomHostName,
} from '../lib/playerPresence';
import {
    hashRoomPassword,
    verifyRoomPassword,
    isValidRoomPassword,
    MIN_ROOM_PASSWORD_LENGTH,
    MAX_ROOM_PASSWORD_LENGTH,
} from '../lib/roomPassword';
import {
    buildRoomPublicEntry,
    roomDeleteUpdates,
    roomPublicPath,
    roomsPurgeAllUpdates,
    ROOMS_PUBLIC_ROOT,
} from '../lib/roomIndex';
import JoinRequestPanel from '../components/JoinRequestPanel';
import RoomInviteQR from '../components/RoomInviteQR';
import {
    JOIN_MODE_OPTIONS,
    normalizeJoinMode,
    normalizeAdmission,
    cycleAdmission,
    getAdmissionOption,
    needsPasswordFromList,
    needsApprovalToJoin,
    isRoomClosedForNewPlayers,
    canJoinFromList,
    defaultShowCodeInList,
    showRoomCodeInList,
} from '../lib/roomAccess';
import { buildGameIndex, buildActiveRoomsFromPublic } from './utils/activeRooms';
import { applyThemeSurface } from '../lib/themeSurface';
import { themePresets, findThemePreset } from '../lib/themePresets';
import versionData from '../../version.json';
import '../styles/app.css';

const NeverHaveIEver = lazy(() => import('../games/never-have-i-ever/NeverHaveIEver'));
const Impostor = lazy(() => import('../games/impostor/Impostor'));
const TruthOrDare = lazy(() => import('../games/truth-or-dare/TruthOrDare'));
const Mafia = lazy(() => import('../games/mafia/Mafia'));
const DarkStories = lazy(() => import('../games/dark-stories/DarkStories'));
const WhoWouldRather = lazy(() => import('../games/who-would-rather/WhoWouldRather'));
const KtoNajpredzej = lazy(() => import('../games/kto-najpredzej/KtoNajpredzej'));
const ComingSoonGame = lazy(() => import('../components/ComingSoonGame'));

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const PAGE_TITLE = 'Party Games';
const ORPHAN_ROOM_TTL_MS = 5 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 3 * 60 * 1000;
const ABANDONED_ROOM_TTL_MS = 90 * 1000;
const ROOM_CLEANUP_COOLDOWN_MS = 30 * 1000;
const BACKGROUND_CLEANUP_INTERVAL_MS = 60 * 1000;
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

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[idx];
    }
    return code;
}

function App() {
    const { runWithBusy } = useServerBusy();
    const [selectedGame, setSelectedGame] = useState(null); // roomId
    const [selectedGameType, setSelectedGameType] = useState(null);
    const [entryRole, setEntryRole] = useState(null);
    const [manualRoomCode, setManualRoomCode] = useState('');
    const [hostJoinMode, setHostJoinMode] = useState('public');
    const [hostRoomPassword, setHostRoomPassword] = useState('');
    const [guestRoomPassword, setGuestRoomPassword] = useState('');
    const [guestPasswordError, setGuestPasswordError] = useState('');
    const [guestPasswordGranted, setGuestPasswordGranted] = useState(false);
    const [guestJoinViaInvite, setGuestJoinViaInvite] = useState(false);
    const [currentRoomJoinMode, setCurrentRoomJoinMode] = useState('public');
    const [roomAdmission, setRoomAdmission] = useState('open');
    const [roomShowCodeInList, setRoomShowCodeInList] = useState(true);
    const [joinRequestList, setJoinRequestList] = useState([]);
    const [waitingForApproval, setWaitingForApproval] = useState(false);
    const [myJoinRequestId, setMyJoinRequestId] = useState(null);
    const [activeRooms, setActiveRooms] = useState([]);
    const [playerName, setPlayerName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [nameError, setNameError] = useState('');
    const [joinStatus, setJoinStatus] = useState('');
    const [lastJoinResult, setLastJoinResult] = useState('');

    const [playersList, setPlayersList] = useState([]);
    const [myPlayerId, setMyPlayerId] = useState(null);

    const [isRoomLocked, setIsRoomLocked] = useState(false); // admission === 'closed'

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
        if (typeof stored?.showConnectionFooter === 'boolean') {
            return stored.showConnectionFooter;
        }
        return false;
    });
    const [adminCommand, setAdminCommand] = useState('');
    const [isAdminMode, setIsAdminMode] = useState(false);
    const [adminBypassEnabled, setAdminBypassEnabled] = useState(false);
    const adminBypassRef = useRef(false);
    const toggleAdminPanel = useCallback(() => {
        setShowAdminPanel((prev) => !prev);
    }, []);
    const logoLongPress = useLongPress(toggleAdminPanel, { delayMs: 650 });
    const prevPlayersCountRef = useRef(0);
    const isHostRef = useRef(isHost);
    const soundEnabledRef = useRef(soundEnabled);
    const vibrationEnabledRef = useRef(vibrationEnabled);
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
    const cachedRoomRef = useRef({
        players: null,
        joinMode: 'public',
        admission: 'open',
        updatedAt: 0,
    });
    const pendingJoinCountRef = useRef(0);
    const showCodeInListRef = useRef(true);
    const prevJoinRequestCountRef = useRef(0);
    const lastSavedUiSettingsRef = useRef('');
    const actionRateRef = useRef(new Map());
    const openRoomAsGuestRef = useRef(null);

    const runRoomsCleanup = useCallback(async (rawRooms, rawRoomsPublic, now = Date.now()) => {
        const raw = rawRooms || {};
        const publicRaw = rawRoomsPublic || {};
        const cleanupUpdates = {};

        Object.entries(raw).forEach(([roomId, room]) => {
            if (!room?.gameId) return;
            const playersEntries = Object.entries(room.players || {});
            const activePlayers = [];

            playersEntries.forEach(([playerId, player]) => {
                if (!player || player.isKicked === true) {
                    cleanupUpdates[`rooms/${roomId}/players/${playerId}`] = null;
                    if (player?.authUid) {
                        cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                    }
                    return;
                }
                if (shouldRemoveInactivePlayer(player, now)) {
                    cleanupUpdates[`rooms/${roomId}/players/${playerId}`] = null;
                    if (player.authUid) {
                        cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                    }
                    return;
                }
                if (isPlayerActive(player, now)) {
                    activePlayers.push(player);
                }
            });

            const hasActiveHost = activePlayers.some((player) => player.isHost === true);
            const ageMs = Math.max(0, now - Number(room.createdAt || 0));
            const publicEntry = publicRaw[roomId];
            const publicAgeMs = publicEntry
                ? Math.max(0, now - Number(publicEntry.updatedAt || room.createdAt || 0))
                : ageMs;
            const neverHadPlayers = playersEntries.length === 0;
            const emptyRoomTtl = neverHadPlayers ? ABANDONED_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
            const isEmptyTooLong = activePlayers.length === 0 && (
                ageMs >= emptyRoomTtl || publicAgeMs >= emptyRoomTtl
            );
            const isOrphanTooLong = !hasActiveHost && ageMs >= ORPHAN_ROOM_TTL_MS;

            if (isEmptyTooLong || isOrphanTooLong) {
                cleanupUpdates[`rooms/${roomId}`] = null;
                cleanupUpdates[roomPublicPath(roomId)] = null;
                playersEntries.forEach(([, player]) => {
                    if (player?.authUid) {
                        cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                    }
                });
            }
        });

        Object.entries(publicRaw).forEach(([roomId, publicEntry]) => {
            if (!publicEntry?.gameId) return;
            if (raw[roomId]) return;
            const publicAgeMs = Math.max(0, now - Number(publicEntry.updatedAt || 0));
            const onlineCount = Math.max(0, Number(publicEntry.onlineCount || 0));
            if (onlineCount <= 0 && publicAgeMs >= ABANDONED_ROOM_TTL_MS) {
                cleanupUpdates[roomPublicPath(roomId)] = null;
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
                orphanUpdates[roomPublicPath(roomId)] = null;
            }
        }
        if (Object.keys(orphanUpdates).length === 0) return;
        await update(ref(db), orphanUpdates);
    }, []);

    const syncRoomPublicSummary = useCallback((
        roomId,
        gameId,
        playersMap,
        joinMode,
        admission,
        pendingCount = pendingJoinCountRef.current
    ) => {
        if (!roomId || !gameId) return;
        if (isLeavingVoluntarily.current) return;
        const now = Date.now();
        if (now - lastRoomPublicSyncAtRef.current < ROOMS_PUBLIC_SYNC_COOLDOWN_MS) return;
        lastRoomPublicSyncAtRef.current = now;
        const onlineCount = countActivePlayers(playersMap, now);
        const hostName = findRoomHostName({ players: playersMap });
        void update(ref(db), {
            [roomPublicPath(roomId)]: buildRoomPublicEntry({
                gameId,
                joinMode,
                admission,
                onlineCount,
                hostName,
                pendingCount,
                showCodeInList: showCodeInListRef.current,
                updatedAt: now,
            }),
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
        vibrationEnabledRef.current = vibrationEnabled;
        isJoinedRef.current = isJoined;
        myPlayerIdRef.current = myPlayerId;
    }, [isHost, soundEnabled, vibrationEnabled, isJoined, myPlayerId]);

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

    const alertHostJoinRequest = useCallback(() => {
        playJoinSound();
        if (
            vibrationEnabledRef.current
            && typeof navigator !== 'undefined'
            && typeof navigator.vibrate === 'function'
        ) {
            navigator.vibrate([120, 60, 120]);
        }
    }, [playJoinSound]);

    const gameById = useMemo(() => buildGameIndex(gameData.games), []);
    const createHostRoomRef = useRef(null);
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
        cachedRoomRef.current = { players: null, joinMode: 'public', admission: 'open', updatedAt: 0 };
        pendingJoinCountRef.current = 0;
        showCodeInListRef.current = true;
        setSelectedGame(null);
        setSelectedGameType(null);
        setIsJoined(false);
        setIsHost(false);
        setMyPlayerId(null);
        setPlayersList([]);
        setNameError('');
        setJoinStatus('');
        setLastJoinResult('');
        setGuestRoomPassword('');
        setGuestPasswordError('');
        setGuestPasswordGranted(false);
        setGuestJoinViaInvite(false);
        setCurrentRoomJoinMode('public');
        setRoomAdmission('open');
        setRoomShowCodeInList(true);
        setJoinRequestList([]);
        setWaitingForApproval(false);
        setMyJoinRequestId(null);
        setIsRoomLocked(false);
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

    useEffect(() => {
        adminBypassRef.current = adminBypassEnabled;
    }, [adminBypassEnabled]);

    /** Tylko ta przeglądarka, która wpisała BYPASS (stan lokalny, nie synchronizowany z Firebase). */
    const hasAdminPowers = adminBypassEnabled;

    const isAdminRateLimited = useCallback(
        (key, cooldownMs) => {
            if (adminBypassRef.current) return false;
            return isRateLimited(key, cooldownMs);
        },
        [isRateLimited]
    );

    const finishAdminCommand = useCallback(() => {
        setAdminCommand('');
        if (!adminBypassRef.current) {
            setShowAdminPanel(false);
        }
    }, []);

    /** Host z bazy (nie tylko przełącznik w lobby) — od tego zależy kick i zamykanie pokoju. */
    const effectiveIsHost = useMemo(() => {
        if (!isJoined || !myPlayerId) return isHost;
        const me = playersList.find((p) => p.id === myPlayerId);
        if (!me) return isHost;
        return me.isHost === true && me.isOnline !== false;
    }, [isJoined, myPlayerId, playersList, isHost]);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const pending = joinRequestList.length;
        if (effectiveIsHost && selectedGame && pending > 0) {
            document.title = `(${pending}) Prośby o wejście — ${PAGE_TITLE}`;
        } else {
            document.title = PAGE_TITLE;
        }
        return () => {
            document.title = PAGE_TITLE;
        };
    }, [joinRequestList.length, effectiveIsHost, selectedGame]);

    /** Pełny adres z parametrem `room` — QR i kopiowanie (kanoniczny origin na Malinie). */
    const roomInviteUrl = useMemo(() => {
        if (!selectedGame || !isHost || typeof window === 'undefined') return '';
        try {
            const base = getPartyOrigin() || window.location.origin;
            const u = new URL(base);
            u.searchParams.set('room', selectedGame);
            u.hash = '';
            return u.toString();
        } catch {
            return '';
        }
    }, [selectedGame, isHost]);

    // Wejście z linku / QR: ?room=<roomId> (pomija hasło prywatnego pokoju)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = (params.get('room') || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        if (!roomFromUrl) return;
        const t = setTimeout(() => {
            void openRoomAsGuestRef.current?.(roomFromUrl, { joinViaInvite: true });
        }, 0);
        return () => clearTimeout(t);
    }, []);

    // Szybkie wejście hosta: ?game=<gameId> (np. /?game=who-would-rather)
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = (params.get('room') || '').trim();
        if (roomFromUrl) return undefined;

        const rawGame = (params.get('game') || '').trim();
        if (!rawGame) return undefined;

        const gameId = resolveGameId(rawGame);
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('game');
            window.history.replaceState({}, '', url.toString());
        } catch {
            /* ignore URL cleanup */
        }

        if (!gameId) {
            setLobbyMessage(`❌ Nieznana gra: ${rawGame}`);
            return undefined;
        }

        if (isGameComingSoon(gameId)) {
            setLobbyMessage(getComingSoonMessage(gameId));
            return undefined;
        }

        setEntryRole('host');
        setIsHost(true);
        const t = setTimeout(() => {
            createHostRoomRef.current?.(gameId);
        }, 0);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const preset = findThemePreset(themePreset);
        const root = document.documentElement;
        root.style.setProperty('--bg-gradient-start', preset.stops[0]);
        root.style.setProperty('--bg-gradient-middle', preset.stops[1]);
        root.style.setProperty('--bg-gradient-end', preset.stops[2]);
        applyThemeSurface(root, preset);
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
                const joinMode = normalizeJoinMode(roomData);
                const admission = normalizeAdmission(roomData);
                const showCode = showRoomCodeInList(roomData);
                setCurrentRoomJoinMode(joinMode);
                setRoomAdmission(admission);
                setRoomShowCodeInList(showCode);
                showCodeInListRef.current = showCode;
                setIsRoomLocked(admission === 'closed');
                cachedRoomRef.current = {
                    ...cachedRoomRef.current,
                    joinMode,
                    admission,
                    updatedAt: Date.now(),
                };
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
                syncRoomPublicSummary(
                    selectedGame,
                    selectedGameType,
                    data,
                    cachedRoomRef.current.joinMode,
                    cachedRoomRef.current.admission,
                    pendingJoinCountRef.current
                );
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

        const admissionRef = ref(db, `rooms/${selectedGame}/admission`);
        const unsubscribeAdmission = onValue(admissionRef, (snapshot) => {
            if (!snapshot.exists()) return;
            const admission = normalizeAdmission({ admission: snapshot.val() });
            const locked = admission === 'closed';
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                admission,
                updatedAt: Date.now(),
            };
            setRoomAdmission(admission);
            setIsRoomLocked(locked);
            if (isHostRef.current && selectedGameType && !isLeavingVoluntarily.current) {
                syncRoomPublicSummary(
                    selectedGame,
                    selectedGameType,
                    cachedRoomRef.current.players || {},
                    cachedRoomRef.current.joinMode,
                    admission,
                    pendingJoinCountRef.current
                );
            }
        });

        const joinModeRef = ref(db, `rooms/${selectedGame}/joinMode`);
        const unsubscribeJoinMode = onValue(joinModeRef, (snapshot) => {
            const joinMode = normalizeJoinMode({ joinMode: snapshot.val() });
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                joinMode,
                updatedAt: Date.now(),
            };
            setCurrentRoomJoinMode(joinMode);
        });

        const showCodeRef = ref(db, `rooms/${selectedGame}/showCodeInList`);
        const unsubscribeShowCode = onValue(showCodeRef, (snapshot) => {
            const joinMode = cachedRoomRef.current.joinMode || 'public';
            const showCode = snapshot.exists()
                ? snapshot.val() === true
                : defaultShowCodeInList(joinMode);
            showCodeInListRef.current = showCode;
            setRoomShowCodeInList(showCode);
        });

        const joinRequestsRef = ref(db, `rooms/${selectedGame}/joinRequests`);
        const unsubscribeJoinRequests = onValue(joinRequestsRef, (snapshot) => {
            const raw = snapshot.val() || {};
            const pending = Object.entries(raw)
                .map(([id, req]) => ({ id, ...req }))
                .filter((req) => req?.status === 'pending' || !req?.status)
                .sort((a, b) => Number(a.requestedAt || 0) - Number(b.requestedAt || 0));
            pendingJoinCountRef.current = pending.length;
            setJoinRequestList(pending);
            if (isHostRef.current && selectedGameType && !isLeavingVoluntarily.current) {
                const newCount = pending.length;
                const prevCount = prevJoinRequestCountRef.current;
                if (newCount > prevCount) {
                    alertHostJoinRequest();
                }
                prevJoinRequestCountRef.current = newCount;
                syncRoomPublicSummary(
                    selectedGame,
                    selectedGameType,
                    cachedRoomRef.current.players || {},
                    cachedRoomRef.current.joinMode,
                    cachedRoomRef.current.admission,
                    newCount
                );
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
            unsubscribeAdmission();
            unsubscribeJoinMode();
            unsubscribeShowCode();
            unsubscribeJoinRequests();
            unsubscribeRoomRoot();
        };
    }, [selectedGame, selectedGameType, alertHostJoinRequest, leaveToLobby, syncRoomPublicSummary, authUser, clearPresenceIndex]);

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

    // Menu gościa: tylko lekki indeks roomsPublic (bez gameState i graczy).
    useEffect(() => {
        if (selectedGame || entryRole !== 'guest') return;
        const unsubPublic = onValue(ref(db, ROOMS_PUBLIC_ROOT), (snapshot) => {
            setActiveRooms(buildActiveRoomsFromPublic(snapshot.val() || {}, gameById));
        });

        return () => {
            unsubPublic();
            setActiveRooms([]);
        };
    }, [selectedGame, entryRole, gameById]);

    useEffect(() => {
        let cancelled = false;
        const tabId = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const leaseOwner = `tab:${tabId}`;

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
                    get(ref(db, ROOMS_PUBLIC_ROOT)),
                ]);
                if (cancelled) return;
                const raw = roomsSnap.val() || {};
                const publicRaw = publicSnap.val() || {};
                await runRoomsCleanup(raw, publicRaw, now);
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
    }, [runRoomsCleanup, cleanupOrphanRoomsPublic]);

    // 4. OBSŁUGA TAJNYCH KOMEND ADMINISTRATORA pod logo
    const handleAdminCommand = useCallback(async () => {
        const rawCmd = adminCommand.trim();
        const cleanedCmd = rawCmd.toUpperCase();

        if (cleanedCmd === '') return;

        const isBypassToggle = cleanedCmd === 'BYPASS';
        const isHelp = cleanedCmd === 'HELP';
        if (!isBypassToggle && !isHelp && !adminBypassRef.current) {
            setAdminCommand('');
            return;
        }

        await runWithBusy(async () => {
        try {
            if (['RESET', 'PURGE', 'PURGE PLAYERS', 'PURGE ROOMS', 'CLEAR'].includes(cleanedCmd)) {
                if (isAdminRateLimited('admin:destructive', RATE_LIMITS_MS.adminDestructive)) {
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
                if (isAdminRateLimited('admin:mutation', RATE_LIMITS_MS.adminMutation)) {
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
                const joinMode = normalizeJoinMode(roomData);
                const admission = normalizeAdmission(roomData);
                const showCodeInList = showRoomCodeInList(roomData);
                await update(ref(db), {
                    [`rooms/${selectedGame}`]: {
                        gameId: roomData.gameId,
                        joinMode,
                        admission,
                        showCodeInList,
                        ...(roomData.passwordHash ? { passwordHash: roomData.passwordHash } : {}),
                        createdAt: roomData.createdAt || now,
                        gameState: null,
                        settings: null,
                        roleHistory: null,
                        players: null,
                        joinRequests: null,
                    },
                    [roomPublicPath(selectedGame)]: buildRoomPublicEntry({
                        gameId: roomData.gameId,
                        joinMode,
                        admission,
                        onlineCount: 0,
                        pendingCount: 0,
                        showCodeInList,
                        updatedAt: now,
                    }),
                });
                setLobbyMessage(`🧹 Konsola: Wyczyszczono pokój ${selectedGame} (bez usuwania).`);
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'RESET') {
                if (window.confirm('⚠️ RESET usunie wszystkie pokoje i graczy. Kontynuować?')) {
                    await update(ref(db), roomsPurgeAllUpdates());
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
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE') {
                if (window.confirm('⚠️ PURGE rozłączy wszystkich graczy i usunie wszystkie pokoje. Kontynuować?')) {
                    await update(ref(db), roomsPurgeAllUpdates());
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
                    finishAdminCommand();
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
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE ROOMS') {
                if (window.confirm('⚠️ PURGE ROOMS usunie wszystkie pokoje. Kontynuować?')) {
                    await update(ref(db), roomsPurgeAllUpdates());
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
                    finishAdminCommand();
                }
                return;
            }

            // ADMIN shortcuts: 'ADMIN' toggles admin mode, or 'ADMIN KICK <name>' to target
            if (cleanedCmd === 'ADMIN') {
                const newState = !isAdminMode;
                setIsAdminMode(newState);
                setLobbyMessage(`🔧 Konsola: Tryb ADMIN ${newState ? 'włączony' : 'wyłączony'}.`);
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'BYPASS') {
                const next = !adminBypassEnabled;
                setAdminBypassEnabled(next);
                adminBypassRef.current = next;
                if (next) {
                    setShowAdminPanel(true);
                } else {
                    setIsAdminMode(false);
                }
                setAdminCommand('');
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
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'HELP') {
                setLobbyMessage(
                    'Komendy: RESET, PURGE, PURGE PLAYERS, PURGE ROOMS, CLEAR, REVEAL, ADMIN KICK <name>, HOST / HOST ME / HOST <name>.'
                );
                finishAdminCommand();
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
                    finishAdminCommand();
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
                finishAdminCommand();
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
                finishAdminCommand();
                return;
            }

            alert('❌ Nieznana komenda administratora.');
        } catch (e) {
            console.error(e);
            alert('❌ Błąd podczas wykonywania komendy. Sprawdź konsolę.');
        }
        });
    }, [adminCommand, selectedGame, myPlayerId, isAdminMode, adminBypassEnabled, runWithBusy, isAdminRateLimited, finishAdminCommand]);

    const completeGuestJoin = useCallback(async (playerId, targetPlayerRef, currentAuthUid, joinStartedAt) => {
        try {
            onDisconnect(targetPlayerRef).update({
                isOnline: false,
                leaveReason: 'disconnect',
                leftAt: { '.sv': 'timestamp' },
            });
        } catch (discErr) {
            console.warn('[join] onDisconnect:', discErr);
        }
        if (currentAuthUid) {
            await updatePresenceIndex(currentAuthUid, selectedGame, playerId);
        }
        isJoinedRef.current = true;
        setIsJoined(true);
        setWaitingForApproval(false);
        setMyJoinRequestId(null);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(LAST_ROOM_KEY, selectedGame);
            setLastKnownRoomId(selectedGame);
        }
        setNameError('');
        joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
        const elapsed = Math.round(performance.now() - joinStartedAt);
        setLastJoinResult(`Ostatnie wejście: ${elapsed} ms`);
        setJoinStatus('');
    }, [selectedGame, updatePresenceIndex]);

    const approveJoinRequest = useCallback(async (requestId) => {
        if (!selectedGame || !myPlayerId) return;
        await runWithBusy(async () => {
            const reqSnap = await get(ref(db, `rooms/${selectedGame}/joinRequests/${requestId}`));
            const req = reqSnap.val();
            if (!req || (req.status && req.status !== 'pending')) return;

            const playersRef = ref(db, `rooms/${selectedGame}/players`);
            const playerRef = push(playersRef);
            await update(ref(db), {
                [`rooms/${selectedGame}/players/${playerRef.key}`]: {
                    name: req.name,
                    authUid: req.authUid || null,
                    isHost: false,
                    isOnline: true,
                    isKicked: false,
                    joinedAt: Date.now(),
                    lastSeenAt: Date.now(),
                },
                [`rooms/${selectedGame}/joinRequests/${requestId}`]: {
                    ...req,
                    status: 'approved',
                    playerId: playerRef.key,
                },
            });
            setLobbyMessage(`✅ Wpuszczono ${req.name || 'gracza'} do pokoju.`);
        });
    }, [selectedGame, myPlayerId, runWithBusy]);

    const rejectJoinRequest = useCallback(async (requestId) => {
        if (!selectedGame) return;
        await remove(ref(db, `rooms/${selectedGame}/joinRequests/${requestId}`));
    }, [selectedGame]);

    const approveAllJoinRequests = useCallback(async () => {
        for (const req of joinRequestList) {
            await approveJoinRequest(req.id);
        }
    }, [joinRequestList, approveJoinRequest]);

    const cycleRoomAdmission = useCallback(async () => {
        if (!selectedGame || !effectiveIsHost) return;
        const next = cycleAdmission(roomAdmission);
        await set(ref(db, `rooms/${selectedGame}/admission`), next);
        setRoomAdmission(next);
        setIsRoomLocked(next === 'closed');
    }, [selectedGame, effectiveIsHost, roomAdmission]);

    const toggleShowCodeInList = useCallback(async () => {
        if (!selectedGame || !(effectiveIsHost || isHost)) return;
        const next = !roomShowCodeInList;
        showCodeInListRef.current = next;
        setRoomShowCodeInList(next);
        await update(ref(db), {
            [`rooms/${selectedGame}/showCodeInList`]: next,
            [`${roomPublicPath(selectedGame)}/showCodeInList`]: next,
        });
    }, [selectedGame, effectiveIsHost, isHost, roomShowCodeInList]);

    const hostShareOptions = useMemo(() => {
        if (!selectedGame || (!isHost && !effectiveIsHost)) return null;
        return {
            inviteUrl: roomInviteUrl,
            roomId: selectedGame,
            showCodeInList: roomShowCodeInList,
            onToggleShowCodeInList: toggleShowCodeInList,
        };
    }, [
        selectedGame,
        isHost,
        effectiveIsHost,
        roomInviteUrl,
        roomShowCodeInList,
        toggleShowCodeInList,
    ]);

    useEffect(() => {
        if (!waitingForApproval || !myJoinRequestId || !selectedGame) return undefined;
        const reqRef = ref(db, `rooms/${selectedGame}/joinRequests/${myJoinRequestId}`);
        const unsubscribe = onValue(reqRef, async (snapshot) => {
            if (!snapshot.exists()) {
                setWaitingForApproval(false);
                setMyJoinRequestId(null);
                setNameError('Host odrzucił prośbę o dołączenie.');
                setJoinStatus('');
                return;
            }
            const reqData = snapshot.val();
            if (reqData?.status !== 'approved' || !reqData?.playerId) return;

            const playerId = reqData.playerId;
            const playerRef = ref(db, `rooms/${selectedGame}/players/${playerId}`);
            myPlayerIdRef.current = playerId;
            setMyPlayerId(playerId);
            setIsHost(false);
            joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
            missingPlayerSinceRef.current = 0;
            await remove(reqRef);
            await completeGuestJoin(playerId, playerRef, authUser?.uid || null, performance.now());
        });
        return () => unsubscribe();
    }, [
        waitingForApproval,
        myJoinRequestId,
        selectedGame,
        authUser,
        completeGuestJoin,
    ]);

    // 5. DOŁĄCZANIE DO POKOJU (NADPISYWANIE DUCHÓW / ZABEZPIECZENIEM PRZED BLOKADĄ)
    const handleJoin = async () => {
        if (isRateLimited('join', RATE_LIMITS_MS.join)) {
            setNameError('⏱️ Za szybkie ponowne dołączenie. Odczekaj chwilę.');
            return;
        }
        const joinStartedAt = performance.now();
        isLeavingVoluntarily.current = false;
        setLobbyMessage('');
        setJoinStatus('');
        const currentAuthUid = authUser?.uid || null;
        const cleanedName = playerName.trim();
        if (cleanedName === '') {
            setNameError('Podaj imię, aby wejść do pokoju.');
            return;
        }
        if (!isHost && needsPasswordFromList(currentRoomJoinMode, guestJoinViaInvite) && !guestPasswordGranted) {
            setNameError('Wpisz poprawne hasło pokoju.');
            return;
        }

        await runWithBusy(async () => {
        setJoinStatus('Łączenie z pokojem...');
        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        let data = cachedRoomRef.current.players;

        if (currentAuthUid) {
            const previousPresenceSnap = await get(ref(db, `${PRESENCE_INDEX_ROOT}/${currentAuthUid}`));
            const previousPresence = previousPresenceSnap.val();
            const previousRoomId = String(previousPresence?.roomId || '');
            const previousPlayerId = String(previousPresence?.playerId || '');
            if (previousRoomId && previousPlayerId) {
                await set(ref(db, `rooms/${previousRoomId}/players/${previousPlayerId}`), null);
                data = null;
                cachedRoomRef.current = { players: null, joinMode: 'public', admission: 'open', updatedAt: 0 };
            }
        }

        let roomMeta = {
            joinMode: cachedRoomRef.current.joinMode,
            admission: cachedRoomRef.current.admission,
        };
        if (!data || Date.now() - cachedRoomRef.current.updatedAt > 1500) {
            setJoinStatus('Pobieranie stanu pokoju...');
            const [playersSnap, roomSnap] = await Promise.all([
                get(ref(db, `rooms/${selectedGame}/players`)),
                get(ref(db, `rooms/${selectedGame}`)),
            ]);
            data = playersSnap.val() || {};
            roomMeta = roomSnap.val() || {};
            const joinMode = normalizeJoinMode(roomMeta);
            const admission = normalizeAdmission(roomMeta);
            cachedRoomRef.current = {
                players: data,
                joinMode,
                admission,
                updatedAt: Date.now(),
            };
            setCurrentRoomJoinMode(joinMode);
            setRoomAdmission(admission);
            setIsRoomLocked(admission === 'closed');
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

        const isReconnect = !!existingPlayerKey;
        const roomForAccess = {
            joinMode: cachedRoomRef.current.joinMode,
            admission: cachedRoomRef.current.admission,
            isLocked: cachedRoomRef.current.admission === 'closed',
            isPrivate: cachedRoomRef.current.joinMode !== 'public',
            passwordHash: roomMeta.passwordHash,
        };

        if (isRoomClosedForNewPlayers(roomForAccess, guestJoinViaInvite, isReconnect)) {
            setNameError('🔒 Pokój jest zamknięty — Host nie wpuszcza nowych graczy.');
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
        } else if (
            !isHost &&
            needsApprovalToJoin(roomForAccess, guestJoinViaInvite, false)
        ) {
            const requestRef = push(ref(db, `rooms/${selectedGame}/joinRequests`));
            await set(requestRef, {
                name: cleanedName,
                authUid: currentAuthUid,
                requestedAt: Date.now(),
                status: 'pending',
            });
            setMyJoinRequestId(requestRef.key);
            setWaitingForApproval(true);
            setJoinStatus('');
            setNameError('');
            setLastJoinResult('Wysłano prośbę do hosta. Czekaj na akceptację.');
            return;
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
                    onDisconnect(targetPlayerRef).update({
                        isOnline: false,
                        leaveReason: 'disconnect',
                        leftAt: { '.sv': 'timestamp' },
                    });
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
                onDisconnect(targetPlayerRef).update({
                    isOnline: false,
                    leaveReason: 'disconnect',
                    leftAt: { '.sv': 'timestamp' },
                });
            } catch (discErr) {
                console.warn('[join] onDisconnect:', discErr);
            }

            await completeGuestJoin(
                targetPlayerRef.key || existingPlayerKey,
                targetPlayerRef,
                currentAuthUid,
                joinStartedAt
            );
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

    const openRoomAsGuest = useCallback(async (roomId, options = {}) => {
        const { joinViaInvite = false, fromList = false } = options;
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
        const joinMode = normalizeJoinMode(roomData);
        if (fromList && !canJoinFromList(joinMode)) {
            setLobbyMessage('🔗 Ten pokój wymaga linku, kodu QR lub kodu pokoju od hosta.');
            return;
        }
        setEntryRole('guest');
        setSelectedGame(normalizedRoomId);
        setSelectedGameType(roomData.gameId);
        setIsHost(false);
        setIsJoined(false);
        setMyPlayerId(null);
        setLobbyMessage('');
        setShowAdminPanel(false);
        setCurrentRoomJoinMode(joinMode);
        setRoomAdmission(normalizeAdmission(roomData));
        setRoomShowCodeInList(showRoomCodeInList(roomData));
        showCodeInListRef.current = showRoomCodeInList(roomData);
        setGuestRoomPassword('');
        setGuestPasswordError('');
        setGuestJoinViaInvite(joinViaInvite);
        setGuestPasswordGranted(
            joinViaInvite || joinMode !== 'password'
        );
        setWaitingForApproval(false);
        setMyJoinRequestId(null);
        cachedRoomRef.current = {
            ...cachedRoomRef.current,
            joinMode,
            admission: normalizeAdmission(roomData),
        };
    }, []);

    const handleGuestRoomPassword = useCallback(async () => {
        if (!selectedGame) return;
        setGuestPasswordError('');
        const password = guestRoomPassword.trim();
        if (!isValidRoomPassword(password)) {
            setGuestPasswordError(
                `Hasło musi mieć ${MIN_ROOM_PASSWORD_LENGTH}–${MAX_ROOM_PASSWORD_LENGTH} znaków.`
            );
            return;
        }
        try {
            const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
            const roomData = roomSnap.val();
            if (normalizeJoinMode(roomData) !== 'password') {
                setGuestPasswordGranted(true);
                return;
            }
            const ok = await verifyRoomPassword(selectedGame, password, roomData.passwordHash);
            if (!ok) {
                setGuestPasswordError('Nieprawidłowe hasło. Spróbuj ponownie.');
                return;
            }
            setGuestPasswordGranted(true);
        } catch {
            setGuestPasswordError('Nie udało się sprawdzić hasła. Spróbuj ponownie.');
        }
    }, [selectedGame, guestRoomPassword]);

    useEffect(() => {
        openRoomAsGuestRef.current = openRoomAsGuest;
    }, [openRoomAsGuest]);

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

    const createHostRoom = useCallback(async (rawGameId, options = {}) => {
        const { joinMode = 'public', password = '' } = options;
        const gameId = resolveGameId(rawGameId);
        if (!gameId) {
            setLobbyMessage(`❌ Nieznana gra: ${rawGameId}`);
            return;
        }
        if (!isPlayableGameId(gameId)) {
            setLobbyMessage(getComingSoonMessage(gameId));
            return;
        }
        if (joinMode === 'password' && !isValidRoomPassword(password)) {
            setLobbyMessage(
                `❌ Hasło musi mieć ${MIN_ROOM_PASSWORD_LENGTH}–${MAX_ROOM_PASSWORD_LENGTH} znaków.`
            );
            return;
        }
        if (isRateLimited('create-room', RATE_LIMITS_MS.createRoom)) {
            setLobbyMessage('⏱️ Tworzysz pokoje zbyt szybko. Odczekaj chwilę.');
            return;
        }
        await runWithBusy(async () => {
            try {
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
                const passwordHash = joinMode === 'password'
                    ? await hashRoomPassword(roomCode, password)
                    : null;
                const showCodeInList = defaultShowCodeInList(joinMode);
                await update(ref(db), {
                    [`rooms/${roomCode}`]: {
                        gameId,
                        joinMode,
                        admission: 'open',
                        showCodeInList,
                        ...(passwordHash ? { passwordHash } : {}),
                        createdAt: now,
                        gameState: null,
                        settings: null,
                    },
                    [roomPublicPath(roomCode)]: buildRoomPublicEntry({
                        gameId,
                        joinMode,
                        admission: 'open',
                        onlineCount: 0,
                        pendingCount: 0,
                        showCodeInList,
                        updatedAt: now,
                    }),
                });
                cachedRoomRef.current = {
                    players: null,
                    joinMode,
                    admission: 'open',
                    updatedAt: now,
                };
                showCodeInListRef.current = showCodeInList;
                setCurrentRoomJoinMode(joinMode);
                setRoomAdmission('open');
                setRoomShowCodeInList(showCodeInList);
                setGuestPasswordGranted(true);
                setGuestJoinViaInvite(false);
                setHostRoomPassword('');
                setEntryRole('host');
                setSelectedGame(roomCode);
                setSelectedGameType(gameId);
                setIsHost(true);
                setLobbyMessage('');
            } catch (err) {
                console.error('[createHostRoom]', err);
                const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
                if (code.includes('PERMISSION_DENIED')) {
                    setLobbyMessage(
                        '❌ Baza odrzuciła tę grę (reguły Firebase). Wdróż database.rules.json: firebase deploy --only database'
                    );
                } else {
                    setLobbyMessage('❌ Nie udało się utworzyć pokoju. Sprawdź połączenie z bazą.');
                }
            }
        });
    }, [runWithBusy, isRateLimited]);

    useEffect(() => {
        createHostRoomRef.current = createHostRoom;
    }, [createHostRoom]);

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
        if (isAdminRateLimited(`admin-kick:${gameId}`, RATE_LIMITS_MS.adminMutation)) {
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
    }, [clearPresenceIndex, isAdminRateLimited]);

    const adminDeleteRoom = useCallback(async (roomId) => {
        await runWithBusy(async () => {
            try {
                await update(ref(db), roomDeleteUpdates(roomId));
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
        const wasHostBeforeJoin = isHost && !isJoined && roomId;
        isLeavingVoluntarily.current = true;
        if (playerId && roomId) {
            onDisconnect(ref(db, `rooms/${roomId}/players/${playerId}`)).cancel();
            remove(ref(db, `rooms/${roomId}/players/${playerId}`));
        } else if (myJoinRequestId && roomId) {
            remove(ref(db, `rooms/${roomId}/joinRequests/${myJoinRequestId}`));
        } else if (wasHostBeforeJoin) {
            void update(ref(db), roomDeleteUpdates(roomId));
        }
        if (authUser?.uid) {
            void clearPresenceIndex(authUser.uid);
        }
        leaveToLobby({ keepEntryRole: true });
    }, [myPlayerId, myJoinRequestId, selectedGame, isHost, isJoined, authUser, clearPresenceIndex, leaveToLobby]);

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
                    ...roomDeleteUpdates(closingRoomId),
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
            <p className="app-version" aria-label={`Wersja ${versionData.version}`}>
                v{versionData.version}
            </p>

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
                            Konsola deweloperska. HELP, RESET, PURGE… Logo „Party Games” ~0,6 s.
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
                            <div className="host-room-options">
                                <p className="host-room-options__label">Tryb dostępu do pokoju</p>
                                <div className="host-join-mode-grid">
                                    {JOIN_MODE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            className={`host-join-mode-option ${hostJoinMode === opt.id ? 'active' : ''}`}
                                            onClick={() => {
                                                setHostJoinMode(opt.id);
                                                if (opt.id !== 'password') setHostRoomPassword('');
                                            }}
                                            aria-pressed={hostJoinMode === opt.id}
                                        >
                                            <span className="host-join-mode-option__title">
                                                {opt.icon} {opt.label}
                                            </span>
                                            <span className="host-join-mode-option__desc">{opt.desc}</span>
                                        </button>
                                    ))}
                                </div>
                                {hostJoinMode === 'password' && (
                                    <div className="host-room-private-fields">
                                        <label className="host-room-private-fields__label" htmlFor="host-room-password">
                                            Hasło pokoju
                                        </label>
                                        <input
                                            id="host-room-password"
                                            type="password"
                                            value={hostRoomPassword}
                                            onChange={(e) => setHostRoomPassword(e.target.value)}
                                            placeholder={`${MIN_ROOM_PASSWORD_LENGTH}–${MAX_ROOM_PASSWORD_LENGTH} znaków`}
                                            maxLength={MAX_ROOM_PASSWORD_LENGTH}
                                            autoComplete="new-password"
                                            className="host-room-private-fields__input"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="games-grid">
                                {gameData.games.map((game) => {
                                    const soon = game.comingSoon === true;
                                    return (
                                        <button
                                            key={game.id}
                                            type="button"
                                            className={soon ? 'game-btn game-btn--soon' : 'game-btn'}
                                            disabled={soon}
                                            aria-disabled={soon}
                                            onClick={() => {
                                                if (soon) {
                                                    setLobbyMessage(getComingSoonMessage(game));
                                                    return;
                                                }
                                                createHostRoom(game.id, {
                                                    joinMode: hostJoinMode,
                                                    password: hostRoomPassword,
                                                });
                                            }}
                                        >
                                            <span className="game-title">
                                                {game.name}
                                                {soon && (
                                                    <span className="game-badge-soon">Wkrótce</span>
                                                )}
                                            </span>
                                            <span className="game-desc">
                                                {soon
                                                    ? 'Gra w trakcie tworzenia — niedostępna.'
                                                    : game.description}
                                            </span>
                                        </button>
                                    );
                                })}
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
                                    onClick={() => openRoomAsGuest(manualRoomCode.trim(), { joinViaInvite: true })}
                                    disabled={manualRoomCode.trim() === ''}
                                >
                                    Dołącz po kodzie
                                </button>
                            </div>
                            <div className="games-grid guest-rooms-grid">
                                {activeRooms.map((room) => (
                                    <div key={room.roomId} className="guest-room-card">
                                        <button
                                            type="button"
                                            className="guest-room-btn"
                                            onClick={() => openRoomAsGuest(room.roomId, { fromList: true })}
                                        >
                                            <span className="game-title">
                                                {room.gameName}
                                                {room.joinModeBadge}{room.admissionBadge}
                                                {room.pendingCount > 0 ? ` · ${room.pendingCount} czeka` : ''}
                                            </span>
                                            <span className="guest-room-host">
                                                {room.hostName
                                                    ? `Pokój gracza „${room.hostName}"`
                                                    : 'Pokój bez hosta'}
                                            </span>
                                            <span className="guest-room-meta">
                                                Gracze online: {room.onlineCount}
                                            </span>
                                            {room.showCode ? (
                                                <span className="guest-room-code">{room.roomId}</span>
                                            ) : (
                                                <span className="guest-room-invite-hint">
                                                    Wejście tylko przez link lub kod od hosta
                                                </span>
                                            )}
                                        </button>
                                        {hasAdminPowers && (
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
                    {effectiveIsHost && (
                        <>
                            <JoinRequestPanel
                                requests={joinRequestList}
                                onApprove={approveJoinRequest}
                                onReject={rejectJoinRequest}
                                onApproveAll={approveAllJoinRequests}
                            />
                            <div className="room-lock-container">
                                <button
                                    type="button"
                                    onClick={cycleRoomAdmission}
                                    className={`btn-lock-toggle ${getAdmissionOption(roomAdmission).buttonClass}`}
                                >
                                    {getAdmissionOption(roomAdmission).icon}{' '}
                                    {getAdmissionOption(roomAdmission).label}
                                    {joinRequestList.length > 0
                                        ? ` (${joinRequestList.length} czeka)`
                                        : ''}
                                    {' '}(kliknij, aby zmienić)
                                </button>
                                <p className="room-admission-hint">
                                    {getAdmissionOption(roomAdmission).desc}
                                </p>
                            </div>
                        </>
                    )}
                    {!isJoined ? (
                        waitingForApproval ? (
                            <div>
                                <h2>Pokój: {currentGameMeta?.name}</h2>
                                <p className="join-progress join-waiting-host">
                                    ⏳ Czekasz na akceptację hosta…
                                </p>
                                <p>Nie zamykaj tej strony. Gdy host Cię wpuści, gra wczyta się automatycznie.</p>
                                <div className="actions-stack">
                                    <button onClick={handleBackToMenu} className="btn-link">Anuluj prośbę</button>
                                </div>
                            </div>
                        ) : !isHost && currentRoomJoinMode === 'password' && !guestPasswordGranted ? (
                            <div>
                                <h2>Pokój: {currentGameMeta?.name}</h2>
                                <p>Ten pokój wymaga hasła (wejście z listy):</p>
                                <input
                                    type="password"
                                    value={guestRoomPassword}
                                    onChange={(e) => {
                                        setGuestRoomPassword(e.target.value);
                                        setGuestPasswordError('');
                                    }}
                                    placeholder={`Hasło (${MIN_ROOM_PASSWORD_LENGTH}–${MAX_ROOM_PASSWORD_LENGTH} znaków)`}
                                    maxLength={MAX_ROOM_PASSWORD_LENGTH}
                                    autoComplete="current-password"
                                    onKeyDown={(e) => e.key === 'Enter' && handleGuestRoomPassword()}
                                    className={guestPasswordError ? 'input-error' : ''}
                                />
                                {guestPasswordError && <p className="error-message">{guestPasswordError}</p>}
                                <div className="actions-stack">
                                    <button
                                        onClick={handleGuestRoomPassword}
                                        disabled={guestRoomPassword.trim().length < MIN_ROOM_PASSWORD_LENGTH}
                                    >
                                        Dalej
                                    </button>
                                    <button onClick={handleBackToMenu} className="btn-link">Wróć</button>
                                </div>
                            </div>
                        ) : (
                        <div>
                            <h2>Pokój: {currentGameMeta?.name}</h2>
                            {isHost && (
                                <p className="join-progress">
                                    Tryb: {JOIN_MODE_OPTIONS.find((o) => o.id === currentRoomJoinMode)?.label || '—'}
                                    {' · '}
                                    Brama: {getAdmissionOption(roomAdmission).label}
                                </p>
                            )}
                            {!isHost && guestJoinViaInvite && (
                                <p className="join-progress">Wejście przez link lub kod — hasło i kolejka pominięte.</p>
                            )}
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

                            {isHost && (
                                <RoomInviteQR
                                    inviteUrl={roomInviteUrl}
                                    roomId={selectedGame}
                                    showCodeInList={roomShowCodeInList}
                                    onToggleShowCodeInList={toggleShowCodeInList}
                                    className="room-invite--slot"
                                />
                            )}

                            <div className="actions-stack">
                                <button onClick={handleJoin} disabled={playerName.trim() === ''}>Wejdź do pokoju</button>
                                <button onClick={handleBackToMenu} className="btn-link">Wróć</button>
                            </div>
                        </div>
                        )
                    ) : (
                        <div>
                            <h2>Grasz w: {currentGameMeta?.name}</h2>

                            <Suspense fallback={<p className="game-loading">Ładowanie gry…</p>}>
                                {selectedGameType === 'never-have-i-ever' && (
                                    <NeverHaveIEver isHost={effectiveIsHost} onLeave={handleLeaveRoom} roomId={selectedGame} shareOptions={hostShareOptions} />
                                )}

                                {selectedGameType === 'truth-or-dare' && (
                                    <TruthOrDare
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        playerName={playerName}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        vibrationEnabled={vibrationEnabled}
                                        roomId={selectedGame}
                                        shareOptions={hostShareOptions}
                                    />
                                )}

                                {selectedGameType === 'impostor' && (
                                    <Impostor
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        onCloseRoom={handleCloseRoom}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        isRoomLocked={isRoomLocked}
                                        roomId={selectedGame}
                                        shareOptions={hostShareOptions}
                                    />
                                )}

                                {selectedGameType === 'mafia' && (
                                    <Mafia
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        isRoomLocked={isRoomLocked}
                                        roomId={selectedGame}
                                        shareOptions={hostShareOptions}
                                    />
                                )}

                                {selectedGameType === 'dark-stories' && (
                                    <DarkStories isHost={effectiveIsHost} onLeave={handleLeaveRoom} roomId={selectedGame} shareOptions={hostShareOptions} />
                                )}

                                {selectedGameType === 'who-would-rather' && (
                                    <WhoWouldRather
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        playerName={playerName}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        vibrationEnabled={vibrationEnabled}
                                        roomId={selectedGame}
                                        shareOptions={hostShareOptions}
                                    />
                                )}

                                {selectedGameType === 'kto-najpredzej' && (
                                    <KtoNajpredzej
                                        isHost={effectiveIsHost}
                                        onLeave={handleLeaveRoom}
                                        roomId={selectedGame}
                                        shareOptions={hostShareOptions}
                                    />
                                )}

                                {selectedGameType &&
                                    isGameComingSoon(selectedGameType) &&
                                    currentGameMeta && (
                                        <ComingSoonGame
                                            title={currentGameMeta.name}
                                            isHost={effectiveIsHost}
                                            onLeave={handleLeaveRoom}
                                        />
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

                                    {hasAdminPowers && p.id && (
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