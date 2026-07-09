import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { GoogleAuthProvider, linkWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { set, get, update } from '../lib/rtdb';
import { db, firebaseConnection, getPartyOrigin, PI_AP_GATEWAY } from '../lib/firebase';
import { auth as firebaseAuth, firestore } from '../lib/firebase/client';
import { buildCatalogIndex, getComingSoonMessage, isGameComingSoon } from '../lib/gameCatalog.js';
import { getLocalizedGameMeta, localizeCatalogGames } from '../lib/gameMeta.js';
import { useLocale } from '../locales/LocaleContext.jsx';
import { resolveGameId, isPlayableGameId } from '../data/gameIds.js';
const BugReportPanel = lazy(() => import('../components/BugReportPanel'));
const AccountCenterPanel = lazy(() => import('./components/AccountCenterPanel'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const AdminConsole = lazy(() => import('./components/AdminConsole'));
import ConnectionStatus from '../components/ConnectionStatus';
import IosWifiHelp from '../components/IosWifiHelp';
import PwaInstallPrompt from '../components/PwaInstallPrompt';
import GlobalAppBanner from '../components/GlobalAppBanner';
import OfflineBanner from '../components/OfflineBanner';
import { useRunWithBusy } from '../context/useRunWithBusy';
import { useLongPress } from '../hooks/useLongPress';
import {
    isLowPowerDevice,
    getJoinGraceMs,
    applyLowPowerClass,
} from '../lib/lowPower';
import {
    isPlayerActive,
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
import {
    normalizeJoinMode,
    normalizeAdmission,
    cycleAdmission,
    needsPasswordFromList,
    needsApprovalToJoin,
    isRoomClosedForNewPlayers,
    canJoinFromList,
    defaultShowCodeInList,
    showRoomCodeInList,
} from '../lib/roomAccess';
import { fingerprintRoomPublicEntry } from '../lib/roomPublicSync';
import { loadLobbyFilters } from '../lib/lobbyFilters';
import { applyThemeSurface } from '../lib/themeSurface';
import { findThemePreset } from '../lib/themePresets';
import { buildBugReportContext, prefetchReporterIpHash } from '../lib/bugReport';
import { buildBugReportDiagnostics } from '../lib/bugReportDiagnostics';
import { prefetchGameChunk } from '../lib/prefetchGameChunk';
import { loadUiSettings, notifyUiSettingsChanged, UI_SETTINGS_KEY } from '../lib/uiSettings';
import { useRoomSnapshot } from '../lib/useRoomSnapshot';
import { usePlayerHeartbeat } from '../lib/usePlayerHeartbeat';
import RoomScreen from './RoomScreen';
import LanguagePicker from './components/LanguagePicker';
import EntryRolePicker from './components/EntryRolePicker';
import HostLobby from './components/HostLobby';
import GuestLobby from './components/GuestLobby';
import {
    ROOMS_PUBLIC_SYNC_COOLDOWN_MS,
    PRESENCE_INDEX_ROOT,
    RATE_LIMITS_MS,
    NICKNAME_KEY,
    LAST_ROOM_KEY,
} from './constants';
import { loadLocalNickname, loadLastRoomId, generateRoomCode } from './utils/localPrefs';
import { useAppAuth } from './hooks/useAppAuth';
import { useGuestRoomsList } from './hooks/useGuestRoomsList';
import { useRoomCleanupScheduler } from './hooks/useRoomCleanupScheduler';
import { useAdminCommands } from './hooks/useAdminCommands';
import versionData from '../../version.json';
import '../styles/app.css';
import { recordRoomCreated, recordNewPlayerJoin } from '../lib/appMetrics.js';
import {
    isGameCreationEnabled,
    isGameJoinEnabled,
    normalizeCmsConfig,
    sortLobbyGames,
} from '../lib/cmsConfig.js';

function App() {
    const { runWithBusy, getPingSnapshot, busyCount, piQueueDepth } = useRunWithBusy();
    const { t, gameContent } = useLocale();
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
    const [guestRoomsListReady, setGuestRoomsListReady] = useState(false);
    const [guestRoomsRefreshing, setGuestRoomsRefreshing] = useState(false);
    const [lobbyFilters, setLobbyFilters] = useState(() => loadLobbyFilters());
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
    const [showBugReport, setShowBugReport] = useState(false);
    const [showLanguagePicker, setShowLanguagePicker] = useState(false);
    const [showAccountCenter, setShowAccountCenter] = useState(false);
    const [accountEmail, setAccountEmail] = useState('');
    const [accountNickname, setAccountNickname] = useState(() => loadLocalNickname());
    const [lastKnownRoomId, setLastKnownRoomId] = useState(() => loadLastRoomId());
    const [authUser, setAuthUser] = useState(null);
    const [authBusy, setAuthBusy] = useState(false);
    const [authStatus, setAuthStatus] = useState('');
    const [cmsConfig, setCmsConfig] = useState(() => normalizeCmsConfig(null, gameContent.games));
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
    const [powerSaveMode, setPowerSaveMode] = useState(() => loadUiSettings()?.powerSaveMode === true);
    const [continuousPingEnabled, setContinuousPingEnabled] = useState(
        () => loadUiSettings()?.continuousPingEnabled === true
    );
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
    const lastRoomPublicSyncAtRef = useRef(0);
    const lastPublicSyncFingerprintRef = useRef('');
    const lastPlayersListFingerprintRef = useRef('');
    const authUserRef = useRef(null);
    const cachedRoomRef = useRef({
        players: null,
        gameState: null,
        gameId: null,
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
        const onlineCount = countActivePlayers(playersMap, now);
        const hostName = findRoomHostName({ players: playersMap });
        const entry = buildRoomPublicEntry({
            gameId,
            joinMode,
            admission,
            onlineCount,
            hostName,
            pendingCount,
            showCodeInList: showCodeInListRef.current,
            updatedAt: now,
        });
        const fingerprint = fingerprintRoomPublicEntry(entry);
        if (fingerprint === lastPublicSyncFingerprintRef.current) return;
        if (now - lastRoomPublicSyncAtRef.current < ROOMS_PUBLIC_SYNC_COOLDOWN_MS) return;
        lastPublicSyncFingerprintRef.current = fingerprint;
        lastRoomPublicSyncAtRef.current = now;
        void update(ref(db), {
            [roomPublicPath(roomId)]: entry,
        }).catch(() => {
            /* best effort room public sync */
        });
    }, []);

    useAppAuth({
        authUser,
        authUserRef,
        gameContentGames: gameContent.games,
        setAuthUser,
        setCmsConfig,
        setAccountNickname,
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nextSettings = {
            themePreset,
            soundEnabled,
            vibrationEnabled,
            showConnectionFooter,
            powerSaveMode,
            continuousPingEnabled,
        };
        const serialized = JSON.stringify(nextSettings);
        if (serialized === lastSavedUiSettingsRef.current) return;

        const timeoutId = window.setTimeout(() => {
            try {
                window.localStorage.setItem(UI_SETTINGS_KEY, serialized);
                lastSavedUiSettingsRef.current = serialized;
                notifyUiSettingsChanged();
                applyLowPowerClass();
            } catch {
                // Ignore storage quota/private mode errors.
            }
        }, 350);

        return () => window.clearTimeout(timeoutId);
    }, [themePreset, soundEnabled, vibrationEnabled, showConnectionFooter, powerSaveMode, continuousPingEnabled]);

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

    const localizedCatalogGames = useMemo(
        () => localizeCatalogGames(gameContent.games, t),
        [gameContent.games, t]
    );
    const sortedLobbyGames = useMemo(
        () => sortLobbyGames(localizedCatalogGames, cmsConfig),
        [localizedCatalogGames, cmsConfig]
    );
    const gameById = useMemo(() => buildCatalogIndex(gameContent.games), [gameContent.games]);
    const createHostRoomRef = useRef(null);
    const currentGameMeta = useMemo(
        () => (selectedGameType
            ? getLocalizedGameMeta(selectedGameType, t, gameById.get(selectedGameType))
            : null),
        [selectedGameType, gameById, t]
    );
    const closeBugReport = useCallback(() => setShowBugReport(false), []);

    useEffect(() => {
        const runPrefetch = () => prefetchReporterIpHash();
        if (typeof requestIdleCallback === 'function') {
            const idleId = requestIdleCallback(runPrefetch, { timeout: 4000 });
            return () => cancelIdleCallback(idleId);
        }
        const timeoutId = window.setTimeout(runPrefetch, 1500);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const prefetchBugReportOnIntent = useCallback(() => {
        prefetchReporterIpHash();
    }, []);

    const leaveToLobby = useCallback((options = {}) => {
        const { message = '', keepEntryRole = true } = options;
        isLeavingVoluntarily.current = true;
        joinGraceUntilRef.current = 0;
        missingPlayerSinceRef.current = 0;
        isJoiningRef.current = false;
        cachedRoomRef.current = { players: null, gameId: null, joinMode: 'public', admission: 'open', updatedAt: 0 };
        pendingJoinCountRef.current = 0;
        showCodeInListRef.current = true;
        lastPlayersListFingerprintRef.current = '';
        lastPublicSyncFingerprintRef.current = '';
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

    const bugReportPlayerStats = useMemo(() => {
        const now = Date.now();
        let active = 0;
        let online = 0;
        for (const player of playersList) {
            if (isPlayerActive(player, now)) active += 1;
            if (player?.isKicked !== true && player?.isOnline !== false) online += 1;
        }
        return {
            active,
            online,
            total: playersList.length,
            pendingJoin: joinRequestList.length,
        };
    }, [playersList, joinRequestList.length]);

    const guestPasswordPending = Boolean(
        selectedGame &&
            !isJoined &&
            !isHost &&
            currentRoomJoinMode === 'password' &&
            !guestPasswordGranted
    );

    const bugReportContext = useMemo(
        () =>
            buildBugReportContext({
                version: versionData.version,
                roomId: selectedGame,
                gameId: selectedGameType,
                gameName: currentGameMeta?.name || null,
                themePreset,
                authEmail: authUser?.email || null,
                connectionMode: firebaseConnection.mode,
                entryRole,
                isJoined,
                isHost,
                effectiveIsHost,
                waitingForApproval,
                guestPasswordPending,
                currentRoomJoinMode,
                roomAdmission,
                playerName,
                accountNickname,
                myPlayerId,
                playerStats: bugReportPlayerStats,
            }),
        [
            selectedGame,
            selectedGameType,
            currentGameMeta?.name,
            themePreset,
            authUser?.email,
            entryRole,
            isJoined,
            isHost,
            effectiveIsHost,
            waitingForApproval,
            guestPasswordPending,
            currentRoomJoinMode,
            roomAdmission,
            playerName,
            accountNickname,
            myPlayerId,
            bugReportPlayerStats,
        ]
    );

    const getBugReportDiagnostics = useCallback(
        () => {
            const ping = getPingSnapshot?.() || {};
            return buildBugReportDiagnostics({
                gameId: selectedGameType,
                gameState: null,
                playersList,
                myPlayerId,
                isHost,
                effectiveIsHost,
                isJoined,
                playerName,
                accountNickname,
                roomId: selectedGame,
                pingMs: ping.pingMs ?? null,
                pingError: ping.pingError ?? false,
                piQueueDepth,
                busyCount,
            });
        },
        [
            getPingSnapshot,
            selectedGameType,
            playersList,
            myPlayerId,
            isHost,
            effectiveIsHost,
            isJoined,
            playerName,
            accountNickname,
            selectedGame,
            piQueueDepth,
            busyCount,
        ]
    );

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const pending = joinRequestList.length;
        const title = t('app.title');
        if (effectiveIsHost && selectedGame && pending > 0) {
            document.title = t('admin.documentTitlePending', { count: pending, title });
        } else {
            document.title = title;
        }
        return () => {
            document.title = title;
        };
    }, [joinRequestList.length, effectiveIsHost, selectedGame, t]);

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
            setLobbyMessage(t('errors.unknownGame', { game: rawGame }));
            return undefined;
        }

        if (isGameComingSoon(gameId)) {
            setLobbyMessage(getComingSoonMessage(gameId, t));
            return undefined;
        }

        prefetchGameChunk(gameId);
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
        if (selectedGameType) prefetchGameChunk(selectedGameType);
    }, [selectedGameType]);

    useEffect(() => {
        if (!selectedGame || selectedGameType) return;
        let active = true;
        const loadRoomType = async () => {
            try {
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val();
                if (!active) return;
                if (!roomData?.gameId) {
                    setLobbyMessage(t('errors.roomNotFound'));
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
                    gameId: roomData.gameId,
                    updatedAt: Date.now(),
                };
            } catch {
                if (!active) return;
                setLobbyMessage(t('errors.roomLoadFailed'));
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
    // Jeden listener RTDB na cały pokój (useRoomSnapshot)
    // =========================================================================
    useRoomSnapshot({
        roomId: selectedGame,
        selectedGameType,
        authUserRef,
        isHostRef,
        isJoinedRef,
        myPlayerIdRef,
        isJoiningRef,
        isLeavingVoluntarily,
        cachedRoomRef,
        pendingJoinCountRef,
        showCodeInListRef,
        prevPlayersCountRef,
        prevJoinRequestCountRef,
        missingPlayerSinceRef,
        joinGraceUntilRef,
        isOnlineHealSentRef,
        lastOnlineHealAtRef,
        lastZombieCleanupAtRef,
        lastPlayersListFingerprintRef,
        setPlayersList,
        setRoomAdmission,
        setIsRoomLocked,
        setCurrentRoomJoinMode,
        setRoomShowCodeInList,
        setJoinRequestList,
        setIsHost,
        leaveToLobby,
        syncRoomPublicSummary,
        alertHostJoinRequest,
        clearPresenceIndex,
        playJoinSound,
        soundEnabledRef,
    });

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

    usePlayerHeartbeat({
        isJoined,
        roomId: selectedGame,
        myPlayerId,
    });

    const { refreshGuestRooms } = useGuestRoomsList({
        selectedGame,
        entryRole,
        gameById,
        lobbyFilters,
        t,
        setActiveRooms,
        setGuestRoomsListReady,
        setGuestRoomsRefreshing,
    });

    useRoomCleanupScheduler({
        isJoined,
        effectiveIsHost,
        hasAdminPowers,
        selectedGame,
    });

    const { handleAdminCommand } = useAdminCommands({
        adminCommand,
        selectedGame,
        myPlayerId,
        isAdminMode,
        adminBypassEnabled,
        adminBypassRef,
        cmsConfig,
        runWithBusy,
        isAdminRateLimited,
        finishAdminCommand,
        t,
        setAdminCommand,
        setLobbyMessage,
        setSelectedGame,
        setSelectedGameType,
        setEntryRole,
        setManualRoomCode,
        setActiveRooms,
        setPlayersList,
        setIsJoined,
        setIsHost,
        setMyPlayerId,
        setNameError,
        setJoinStatus,
        setLastJoinResult,
        setIsAdminMode,
        setAdminBypassEnabled,
        setShowAdminPanel,
    });

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
            recordNewPlayerJoin({
                dedupeKey: `${selectedGame}:${playerRef.key}`,
            });
            setLobbyMessage(t('errors.approvedPlayer', { name: req.name || t('common.player') }));
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
                setNameError(t('errors.joinRejected'));
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
            setNameError(t('errors.joinTooFast'));
            return;
        }
        const joinStartedAt = performance.now();
        isLeavingVoluntarily.current = false;
        setLobbyMessage('');
        setJoinStatus('');
        const currentAuthUid = authUser?.uid || null;
        const cleanedName = playerName.trim();
        if (cleanedName === '') {
            setNameError(t('errors.emptyName'));
            return;
        }
        if (!isHost && needsPasswordFromList(currentRoomJoinMode, guestJoinViaInvite) && !guestPasswordGranted) {
            setNameError(t('errors.emptyPassword'));
            return;
        }

        await runWithBusy(async () => {
        setJoinStatus(t('errors.joinConnecting'));
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
                cachedRoomRef.current = { players: null, gameId: null, joinMode: 'public', admission: 'open', updatedAt: 0 };
            }
        }

        let roomMeta = {
            joinMode: cachedRoomRef.current.joinMode,
            admission: cachedRoomRef.current.admission,
            gameId: cachedRoomRef.current.gameId || selectedGameType,
            passwordHash: cachedRoomRef.current.passwordHash,
        };
        if (!data || Date.now() - cachedRoomRef.current.updatedAt > 1500) {
            setJoinStatus(t('errors.joinFetching'));
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
                gameId: roomMeta.gameId || selectedGameType,
                passwordHash: roomMeta.passwordHash,
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

        if (!isReconnect && !isGameJoinEnabled(cmsConfig, roomMeta.gameId || selectedGameType, gameContent.games)) {
            setNameError(t('cms.gameDisabledMessage'));
            return;
        }

        if (isRoomClosedForNewPlayers(roomForAccess, guestJoinViaInvite, isReconnect)) {
            setNameError(t('errors.roomLocked'));
            return;
        }

        let targetPlayerRef;
        let finalIsHost = isHost;

        if (existingPlayerKey) {
            const existingPlayer = data[existingPlayerKey];
            const isSameAccount = currentAuthUid && existingPlayer.authUid === currentAuthUid;

            if (existingPlayer.isKicked) {
                setNameError(t('errors.kickedName'));
                return;
            }

            if (existingPlayer.isGuest) {
                setNameError(t('errors.guestNameTaken'));
                return;
            }

            if (existingPlayer.isOnline !== false && !isSameAccount) {
                setNameError(t('errors.nameTaken'));
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
            setLastJoinResult(t('errors.joinRequestSent'));
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
                recordNewPlayerJoin({
                    dedupeKey: `${selectedGame}:${newPlayerRef.key}`,
                });
                isJoiningRef.current = false;
                return;
            }
        }

        joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
        missingPlayerSinceRef.current = 0;
        isJoiningRef.current = true;

        try {
            setJoinStatus(t('errors.joinSaving'));
            await set(targetPlayerRef, {
                name: cleanedName,
                authUid: currentAuthUid,
                isHost: finalIsHost,
                isOnline: true,
                isKicked: false,
                joinedAt: Date.now(),
                lastSeenAt: Date.now(),
            }, { priority: true });

            setJoinStatus(t('errors.joinVerifying'));
            const verify = await get(targetPlayerRef);
            if (!verify.val()?.name) {
                setNameError(t('errors.joinSaveFailed'));
                setLastJoinResult(t('errors.joinErrorRetry'));
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
            if (!existingPlayerKey) {
                recordNewPlayerJoin({
                    dedupeKey: `${selectedGame}:${targetPlayerRef.key || ''}`,
                });
            }
        } catch (err) {
            console.error(err);
            joinGraceUntilRef.current = 0;
            setNameError(t('errors.joinFailed'));
            setLastJoinResult(t('errors.joinErrorConnection'));
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
            setLobbyMessage(t('errors.roomClosed'));
            return;
        }
        const joinMode = normalizeJoinMode(roomData);
        if (fromList && !canJoinFromList(joinMode)) {
            setLobbyMessage(t('errors.roomInviteOnly'));
            return;
        }
        prefetchGameChunk(roomData.gameId);
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
            gameId: roomData.gameId,
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
                setGuestPasswordError(t('errors.wrongPassword'));
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
            setLobbyMessage(t('errors.unknownGame', { game: rawGameId }));
            return;
        }
        if (!isPlayableGameId(gameId)) {
            setLobbyMessage(getComingSoonMessage(gameId, t));
            return;
        }
        if (!isGameCreationEnabled(cmsConfig, gameId, gameContent.games)) {
            setLobbyMessage(t('cms.gameDisabledMessage'));
            return;
        }
        prefetchGameChunk(gameId);
        if (joinMode === 'password' && !isValidRoomPassword(password)) {
            setLobbyMessage(
                t('notifications.roomPasswordInvalid', {
                    min: MIN_ROOM_PASSWORD_LENGTH,
                    max: MAX_ROOM_PASSWORD_LENGTH,
                })
            );
            return;
        }
        if (isRateLimited('create-room', RATE_LIMITS_MS.createRoom)) {
            setLobbyMessage(t('notifications.rateLimitCreateRoom'));
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
                    setLobbyMessage(t('notifications.roomCodeFailed'));
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
                    gameId,
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
                prefetchGameChunk(gameId);
                setEntryRole('host');
                setSelectedGame(roomCode);
                setSelectedGameType(gameId);
                setIsHost(true);
                setLobbyMessage('');
                recordRoomCreated(gameId);
            } catch (err) {
                console.error('[createHostRoom]', err);
                const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
                if (code.includes('PERMISSION_DENIED')) {
                    setLobbyMessage(t('notifications.roomCreatePermissionDenied'));
                } else {
                    setLobbyMessage(t('notifications.roomCreateFailed'));
                }
            }
        });
    }, [cmsConfig, gameContent.games, runWithBusy, isRateLimited, t]);

    useEffect(() => {
        createHostRoomRef.current = createHostRoom;
    }, [createHostRoom]);

    const kickPlayer = useCallback(async (playerId) => {
        if (!selectedGame || !myPlayerId) return;
        if (isRateLimited(`kick:${selectedGame}`, RATE_LIMITS_MS.kick)) {
            setLobbyMessage(t('notifications.rateLimitKick'));
            return;
        }
        await runWithBusy(async () => {
            try {
                const meSnap = await get(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
                if (!meSnap.val()?.isHost) {
                    alert(t('notifications.onlyHostCanKick'));
                    return;
                }
                const targetRef = ref(db, `rooms/${selectedGame}/players/${playerId}`);
                const targetSnap = await get(targetRef);
                const target = targetSnap.val();
                if (!target) return;
                if (target.isHost) {
                    alert(t('notifications.cannotKickHost'));
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

                setLobbyMessage(t('notifications.hostKicked', {
                    name: target.name || t('common.player'),
                }));

                if (selectedGameType === 'telepathy' || selectedGameType === 'just-one') {
                    try {
                        const buildSync =
                            selectedGameType === 'just-one'
                                ? buildJustOneSyncUpdates
                                : buildTelepathySyncUpdates;
                        const { updates } = await buildSync(selectedGame);
                        if (Object.keys(updates).length > 0) {
                            await update(ref(db), updates);
                        }
                    } catch (syncErr) {
                        console.warn(`[${selectedGameType}] sync after kick:`, syncErr);
                    }
                }
            } catch (err) {
                console.error(err);
                alert(t('notifications.kickErrorConnection'));
            }
        });
    }, [selectedGame, selectedGameType, myPlayerId, runWithBusy, clearPresenceIndex, isRateLimited, t]);

    const adminKick = useCallback(async (gameId, playerKey) => {
        if (isAdminRateLimited(`admin-kick:${gameId}`, RATE_LIMITS_MS.adminMutation)) {
            setLobbyMessage(t('admin.rateLimitAdminKick'));
            return;
        }
        try {
            const snap = await get(ref(db, `rooms/${gameId}/players/${playerKey}`));
            const p = snap.val();
            if (!p) {
                alert(t('admin.playerNotFound'));
                return;
            }
            // Admin powinien móc usunąć dowolnego gracza natychmiast
            await remove(ref(db, `rooms/${gameId}/players/${playerKey}`));
            if (p.authUid) {
                await clearPresenceIndex(p.authUid);
            }
            setLobbyMessage(t('admin.adminKicked', {
                name: p.name || playerKey,
                roomId: gameId,
            }));

            const roomSnap = await get(ref(db, `rooms/${gameId}`));
            const kickedGameId = roomSnap.val()?.gameId;
            if (kickedGameId === 'telepathy' || kickedGameId === 'just-one') {
                try {
                    const buildSync =
                        kickedGameId === 'just-one'
                            ? buildJustOneSyncUpdates
                            : buildTelepathySyncUpdates;
                    const { updates } = await buildSync(gameId);
                    if (Object.keys(updates).length > 0) {
                        await update(ref(db), updates);
                    }
                } catch (syncErr) {
                    console.warn(`[${kickedGameId}] sync after admin kick:`, syncErr);
                }
            }
        } catch (e) {
            console.error(e);
            alert(t('admin.kickError'));
        }
    }, [clearPresenceIndex, isAdminRateLimited, t]);

    const adminDeleteRoom = useCallback(async (roomId) => {
        await runWithBusy(async () => {
            try {
                await update(ref(db), roomDeleteUpdates(roomId));
                setLobbyMessage(t('admin.roomDeleted', { roomId }));
            } catch (e) {
                console.error(e);
                alert(t('admin.roomDeleteError'));
            }
        });
    }, [runWithBusy, t]);

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
                setLobbyMessage(t('notifications.roomCloseFailed'));
            } finally {
                if (authUser?.uid) {
                    void clearPresenceIndex(authUser.uid);
                }
                leaveToLobby({ keepEntryRole: true });
            }
        });
    }, [selectedGame, myPlayerId, runWithBusy, authUser, clearPresenceIndex, leaveToLobby, t]);

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
                setAuthStatus(t('account.savedRemote'));
            } else {
                setAuthStatus(t('account.savedLocal'));
            }
            setPlayerName((prev) => (prev.trim() ? prev : nickname));
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : t('account.saveFailed'));
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

    const overlayOpen = showAccountCenter
        ? 'account'
        : showSettings
          ? 'settings'
          : showBugReport
            ? 'bug-report'
            : showLanguagePicker
              ? 'language'
              : null;

    const appContainerRef = useRef(null);

    useLayoutEffect(() => {
        const root = appContainerRef.current;
        if (!root) return undefined;

        if (!overlayOpen) {
            root.style.removeProperty('--overlay-stack-1');
            root.style.removeProperty('--overlay-stack-2');
            root.style.removeProperty('--overlay-stack-3');
            return undefined;
        }

        const panelSelector =
            overlayOpen === 'account'
                ? '.account-panel'
                : overlayOpen === 'settings'
                  ? '.settings-panel:not(.bug-report-panel):not(.language-panel)'
                  : overlayOpen === 'language'
                    ? '.language-panel'
                    : '.bug-report-panel';

        const updateStack = () => {
            const panel = root.querySelector(panelSelector);
            if (!panel) return;
            const stack1 = panel.getBoundingClientRect().bottom + 10;
            root.style.setProperty('--overlay-stack-1', `${stack1}px`);
            root.style.setProperty('--overlay-stack-2', `${stack1 + 56}px`);
            root.style.setProperty('--overlay-stack-3', `${stack1 + 112}px`);
        };

        updateStack();

        const panel = root.querySelector(panelSelector);
        if (!panel) return undefined;

        const ro = new ResizeObserver(updateStack);
        ro.observe(panel);
        window.addEventListener('resize', updateStack);

        return () => {
            ro.disconnect();
            window.removeEventListener('resize', updateStack);
            root.style.removeProperty('--overlay-stack-1');
            root.style.removeProperty('--overlay-stack-2');
            root.style.removeProperty('--overlay-stack-3');
        };
    }, [overlayOpen]);

    return (
        <div
            ref={appContainerRef}
            className="app-container"
            data-overlay-open={overlayOpen ?? undefined}
        >
            {/* Logo z obsługą double click (Easter egg panelu admina) */}
            <h1
                onDoubleClick={toggleAdminPanel}
                className="main-logo-clickable"
                title={t('app.logoHint')}
                {...logoLongPress}
            >
                {t('app.title')}
            </h1>
            <p className="app-version" aria-label={t('common.version', { version: versionData.version })}>
                v{versionData.version}
            </p>

            <OfflineBanner />
            <GlobalAppBanner banner={cmsConfig.banner} />
            <PwaInstallPrompt />
            <IosWifiHelp />

            {firebaseConnection.mode === 'emulator' && (
                <div className="party-ap-banner" role="alert">
                    {firebaseConnection.onPartyGateway ? (
                        <span>{t('app.partyBannerOnGateway', { gateway: PI_AP_GATEWAY, wifi: 'PartBox-Gry' })}</span>
                    ) : (
                        <>
                            {t('app.partyBannerOffGateway', { wifi: 'PartBox-Gry', link: '' })}{' '}
                            <a href={`http://${PI_AP_GATEWAY}`}>http://{PI_AP_GATEWAY}</a>
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
                    setShowBugReport(false);
                    setShowLanguagePicker(false);
                }}
                aria-label={t('triggers.account')}
                aria-hidden={showAccountCenter || undefined}
                tabIndex={showAccountCenter ? -1 : undefined}
            >
                👤
            </button>

            <button
                type="button"
                className="settings-trigger"
                onClick={() => {
                    setShowSettings((prev) => !prev);
                    setShowAccountCenter(false);
                    setShowBugReport(false);
                    setShowLanguagePicker(false);
                }}
                aria-label={t('triggers.settings')}
                aria-hidden={showSettings || undefined}
                tabIndex={showSettings ? -1 : undefined}
            >
                ⚙
            </button>

            <button
                type="button"
                className="bug-report-trigger"
                onPointerEnter={prefetchBugReportOnIntent}
                onFocus={prefetchBugReportOnIntent}
                onClick={() => {
                    setShowBugReport((prev) => !prev);
                    setShowSettings(false);
                    setShowAccountCenter(false);
                    setShowLanguagePicker(false);
                }}
                aria-label={t('triggers.bugReport')}
                aria-hidden={showBugReport || undefined}
                tabIndex={showBugReport ? -1 : undefined}
            >
                🐛
            </button>

            {showBugReport && (
                <Suspense fallback={null}>
                    <BugReportPanel
                        context={bugReportContext}
                        getDiagnostics={getBugReportDiagnostics}
                        onClose={closeBugReport}
                    />
                </Suspense>
            )}

            <LanguagePicker
                open={showLanguagePicker}
                onToggle={() => {
                    setShowLanguagePicker((prev) => !prev);
                    setShowSettings(false);
                    setShowAccountCenter(false);
                    setShowBugReport(false);
                }}
                onClose={() => setShowLanguagePicker(false)}
            />

            {showAccountCenter && (
                <Suspense fallback={null}>
                    <AccountCenterPanel
                        authUser={authUser}
                        authBusy={authBusy}
                        authStatus={authStatus}
                        accountNickname={accountNickname}
                        accountEmail={accountEmail}
                        nicknameSavedAt={nicknameSavedAt}
                        lastKnownRoomId={lastKnownRoomId}
                        isJoined={isJoined}
                        hasGoogleProvider={hasGoogleProvider}
                        hasEmailProvider={hasEmailProvider}
                        onClose={() => setShowAccountCenter(false)}
                        onNicknameChange={setAccountNickname}
                        onEmailChange={setAccountEmail}
                        onSaveNickname={handleSaveNickname}
                        onGoogleAuth={handleGoogleAuth}
                        onSendMagicLink={handleSendMagicLink}
                        onCompleteMagicLink={handleCompleteMagicLink}
                        onConnectGoogle={handleConnectGoogle}
                        onSignOut={handleSignOut}
                        onJoinLastKnownGame={handleJoinLastKnownGame}
                    />
                </Suspense>
            )}

            {showSettings && (
                <Suspense fallback={null}>
                    <SettingsPanel
                        themePreset={themePreset}
                        soundEnabled={soundEnabled}
                        vibrationEnabled={vibrationEnabled}
                        showConnectionFooter={showConnectionFooter}
                        continuousPingEnabled={continuousPingEnabled}
                        powerSaveMode={powerSaveMode}
                        showAdminPanel={showAdminPanel}
                        onClose={() => setShowSettings(false)}
                        onThemeChange={setThemePreset}
                        onSoundToggle={() => setSoundEnabled((prev) => !prev)}
                        onVibrationToggle={() => setVibrationEnabled((prev) => !prev)}
                        onConnectionFooterToggle={() => setShowConnectionFooter((prev) => !prev)}
                        onContinuousPingToggle={() => setContinuousPingEnabled((prev) => !prev)}
                        onPowerSaveToggle={() => setPowerSaveMode((prev) => !prev)}
                        onOpenAdminPanel={() => {
                            toggleAdminPanel();
                            setShowSettings(false);
                        }}
                    />
                </Suspense>
            )}

            {lobbyMessage && <p className="error-message">{lobbyMessage}</p>}

            {/* PANEL DEWELOPERSKI */}
            {showAdminPanel && (
                <Suspense fallback={null}>
                    <AdminConsole
                        adminCommand={adminCommand}
                        onCommandChange={setAdminCommand}
                        onSubmit={handleAdminCommand}
                    />
                </Suspense>
            )}

            {!selectedGame ? (
                <div>
                    {!entryRole && (
                        <EntryRolePicker
                            onSelectHost={() => setEntryRole('host')}
                            onSelectGuest={() => setEntryRole('guest')}
                        />
                    )}

                    {entryRole === 'host' && (
                        <HostLobby
                            games={sortedLobbyGames}
                            hostJoinMode={hostJoinMode}
                            hostRoomPassword={hostRoomPassword}
                            onJoinModeChange={(mode) => {
                                setHostJoinMode(mode);
                                if (mode !== 'password') setHostRoomPassword('');
                            }}
                            onPasswordChange={setHostRoomPassword}
                            onCreateRoom={createHostRoom}
                            onComingSoon={setLobbyMessage}
                            onBack={() => setEntryRole(null)}
                        />
                    )}

                    {entryRole === 'guest' && (
                        <GuestLobby
                            manualRoomCode={manualRoomCode}
                            onManualRoomCodeChange={setManualRoomCode}
                            onJoinByCode={(code) => openRoomAsGuest(code, { joinViaInvite: true })}
                            lobbyFilters={lobbyFilters}
                            onLobbyFiltersChange={setLobbyFilters}
                            activeRooms={activeRooms}
                            roomsListReady={guestRoomsListReady}
                            onRefreshRooms={refreshGuestRooms}
                            roomsRefreshing={guestRoomsRefreshing}
                            onOpenRoom={openRoomAsGuest}
                            hasAdminPowers={hasAdminPowers}
                            onAdminDeleteRoom={adminDeleteRoom}
                            onBack={() => setEntryRole(null)}
                        />
                    )}
                </div>
            ) : (
                <RoomScreen
                    selectedGame={selectedGame}
                    selectedGameType={selectedGameType}
                    currentGameMeta={currentGameMeta}
                    effectiveIsHost={effectiveIsHost}
                    isHost={isHost}
                    isJoined={isJoined}
                    roomAdmission={roomAdmission}
                    joinRequestList={joinRequestList}
                    cycleRoomAdmission={cycleRoomAdmission}
                    approveJoinRequest={approveJoinRequest}
                    rejectJoinRequest={rejectJoinRequest}
                    approveAllJoinRequests={approveAllJoinRequests}
                    waitingForApproval={waitingForApproval}
                    currentRoomJoinMode={currentRoomJoinMode}
                    guestPasswordGranted={guestPasswordGranted}
                    guestRoomPassword={guestRoomPassword}
                    setGuestRoomPassword={setGuestRoomPassword}
                    guestPasswordError={guestPasswordError}
                    setGuestPasswordError={setGuestPasswordError}
                    handleGuestRoomPassword={handleGuestRoomPassword}
                    guestJoinViaInvite={guestJoinViaInvite}
                    playerName={playerName}
                    setPlayerName={setPlayerName}
                    nameError={nameError}
                    setNameError={setNameError}
                    joinStatus={joinStatus}
                    lastJoinResult={lastJoinResult}
                    handleJoin={handleJoin}
                    handleBackToMenu={handleBackToMenu}
                    roomInviteUrl={roomInviteUrl}
                    roomShowCodeInList={roomShowCodeInList}
                    toggleShowCodeInList={toggleShowCodeInList}
                    handleLeaveRoom={handleLeaveRoom}
                    handleCloseRoom={handleCloseRoom}
                    myPlayerId={myPlayerId}
                    vibrationEnabled={vibrationEnabled}
                    isRoomLocked={isRoomLocked}
                    hostShareOptions={hostShareOptions}
                    playersList={playersList}
                    runWithBusy={runWithBusy}
                    kickPlayer={kickPlayer}
                    hasAdminPowers={hasAdminPowers}
                    adminKick={adminKick}
                />
            )}

            {showConnectionFooter && <ConnectionStatus />}
        </div>
    );
}

export default App;