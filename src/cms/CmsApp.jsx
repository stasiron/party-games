import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { db } from '../lib/firebase';
import { auth as firebaseAuth } from '../lib/firebase/client';
import { get, remove, update } from '../lib/rtdb';
import { localizeCatalogGames } from '../lib/gameMeta.js';
import {
    APP_CONFIG_PATH,
    CMS_COMMAND_TOGGLES,
    isCmsAdminUser,
    normalizeCmsConfig,
    sortLobbyGames,
    isAdminCommandEnabled,
} from '../lib/cmsConfig.js';
import {
    buildRoomPublicEntry,
    roomDeleteUpdates,
    roomPublicPath,
    roomsPurgeAllUpdates,
} from '../lib/roomIndex';
import {
    normalizeAdmission,
    normalizeJoinMode,
    showRoomCodeInList,
} from '../lib/roomAccess';
import { isPlayerActive } from '../lib/playerPresence';
import {
    buildJustOneAdvanceRoundUpdatesFromRoom,
    buildJustOneSyncUpdates,
    canAdvanceJustOneRound,
} from '../lib/justOneState';
import {
    buildTelepathyAdvanceRoundUpdatesFromRoom,
    buildTelepathySyncUpdates,
    canAdvanceTelepathyRound,
} from '../lib/telepathyState';
import { PRESENCE_INDEX_ROOT } from '../app/constants';
import { useLocale } from '../locales/LocaleContext.jsx';
import {
    fetchDailyMetrics,
    METRICS_HISTORY_DAYS,
    sumMetricsRows,
} from '../lib/appMetrics.js';
import CmsAccordionSection from './CmsAccordionSection.jsx';

function getOwnerOnline(playersMap, ownerId, now) {
    if (!ownerId || !playersMap?.[ownerId]) return false;
    return isPlayerActive(playersMap[ownerId], now);
}

function buildRoomStats(roomId, roomData, localizedById) {
    const playersMap = roomData?.players || {};
    const now = Date.now();
    let devicesOnline = 0;
    let devicesOffline = 0;
    let playersOnline = 0;
    let playersOffline = 0;
    const players = Object.entries(playersMap)
        .map(([id, player]) => ({ id, ...(player || {}) }))
        .filter((player) => player.isKicked !== true);

    for (const player of players) {
        const isGuest = player.isGuest === true;
        const online = isGuest
            ? getOwnerOnline(playersMap, player.linkedToPlayerId, now)
            : isPlayerActive(player, now);

        if (isGuest) {
            if (online) playersOnline += 1;
            else playersOffline += 1;
            continue;
        }

        if (online) {
            devicesOnline += 1;
            playersOnline += 1;
        } else {
            devicesOffline += 1;
            playersOffline += 1;
        }
    }

    const game = localizedById.get(roomData?.gameId) || { name: roomData?.gameId || roomId };
    const host = players.find((player) => player.isHost === true) || null;

    return {
        roomId,
        gameId: roomData?.gameId || '',
        gameName: game.name,
        joinMode: normalizeJoinMode(roomData),
        admission: normalizeAdmission(roomData),
        showCodeInList: showRoomCodeInList(roomData),
        createdAt: Number(roomData?.createdAt || 0),
        devicesOnline,
        devicesOffline,
        devicesTotal: devicesOnline + devicesOffline,
        playersOnline,
        playersOffline,
        playersTotal: playersOnline + playersOffline,
        hostName: host?.name || '',
        players,
        roomData,
    };
}

function CmsApp() {
    const { t, gameContent } = useLocale();
    const [authUser, setAuthUser] = useState(null);
    const [authBusy, setAuthBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [cmsConfig, setCmsConfig] = useState(() => normalizeCmsConfig(null, gameContent.games));
    const [rooms, setRooms] = useState([]);
    const [roomsLoadedAt, setRoomsLoadedAt] = useState(0);
    const [roomsLoading, setRoomsLoading] = useState(false);
    const [selectedRoomId, setSelectedRoomId] = useState('');
    const [commandInput, setCommandInput] = useState('');
    const [bannerDraft, setBannerDraft] = useState({
        enabled: false,
        titlePl: '',
        titleEn: '',
        bodyPl: '',
        bodyEn: '',
    });
    const [dailyMetrics, setDailyMetrics] = useState([]);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [metricsLoadedAt, setMetricsLoadedAt] = useState(0);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
            setAuthUser(user);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const cfgRef = ref(db, APP_CONFIG_PATH);
        const unsubscribe = onValue(cfgRef, (snapshot) => {
            setCmsConfig(normalizeCmsConfig(snapshot.val(), gameContent.games));
        });
        return () => unsubscribe();
    }, [gameContent.games]);

    useEffect(() => {
        const banner = cmsConfig.banner;
        setBannerDraft({
            enabled: banner.enabled,
            titlePl: banner.title.pl,
            titleEn: banner.title.en,
            bodyPl: banner.body.pl,
            bodyEn: banner.body.en,
        });
    }, [cmsConfig.banner]);

    const localizedGames = useMemo(
        () => localizeCatalogGames(gameContent.games, t),
        [gameContent.games, t]
    );
    const sortedGames = useMemo(
        () => sortLobbyGames(localizedGames, cmsConfig),
        [localizedGames, cmsConfig]
    );
    const localizedById = useMemo(
        () => new Map(localizedGames.map((game) => [game.id, game])),
        [localizedGames]
    );
    const roomMap = useMemo(
        () => new Map(rooms.map((room) => [room.roomId, room])),
        [rooms]
    );
    const selectedRoom = selectedRoomId ? roomMap.get(selectedRoomId) || null : null;
    const isAdmin = isCmsAdminUser(authUser);

    const refreshRooms = useCallback(async () => {
        if (!isAdmin) return;
        setRoomsLoading(true);
        try {
            const snapshot = await get(ref(db, 'rooms'));
            const rawRooms = snapshot.val() || {};
            const nextRooms = Object.entries(rawRooms)
                .filter(([, room]) => room?.gameId)
                .map(([roomId, room]) => buildRoomStats(roomId, room, localizedById))
                .sort((a, b) => {
                    if (a.gameName !== b.gameName) return a.gameName.localeCompare(b.gameName);
                    return a.roomId.localeCompare(b.roomId);
                });
            setRooms(nextRooms);
            setRoomsLoadedAt(Date.now());
            if (!selectedRoomId && nextRooms[0]?.roomId) {
                setSelectedRoomId(nextRooms[0].roomId);
            }
            setStatus(t('cms.roomsRefreshed'));
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomsRefreshError'));
        } finally {
            setRoomsLoading(false);
        }
    }, [isAdmin, localizedById, selectedRoomId, t]);

    useEffect(() => {
        if (!isAdmin) return;
        void refreshRooms();
    }, [isAdmin, refreshRooms]);

    const refreshMetrics = useCallback(async () => {
        if (!isAdmin) return;
        setMetricsLoading(true);
        try {
            const rows = await fetchDailyMetrics(METRICS_HISTORY_DAYS);
            setDailyMetrics(rows);
            setMetricsLoadedAt(Date.now());
        } catch (error) {
            console.error(error);
            setStatus(t('cms.statsRefreshError'));
        } finally {
            setMetricsLoading(false);
        }
    }, [isAdmin, t]);

    useEffect(() => {
        if (!isAdmin) return;
        void refreshMetrics();
    }, [isAdmin, refreshMetrics]);

    const metricsSummary7 = useMemo(
        () => sumMetricsRows(dailyMetrics, 7),
        [dailyMetrics]
    );
    const metricsSummary14 = useMemo(
        () => sumMetricsRows(dailyMetrics, 14),
        [dailyMetrics]
    );
    const metricsByGame = useMemo(() => {
        return Object.entries(metricsSummary14.byGame || {})
            .map(([gameId, entry]) => ({
                gameId,
                gameName: localizedById.get(gameId)?.name || gameId,
                gamesStarted: entry.gamesStarted || 0,
                roomsCreated: entry.roomsCreated || 0,
            }))
            .filter((row) => row.gamesStarted > 0 || row.roomsCreated > 0)
            .sort((a, b) => b.gamesStarted - a.gamesStarted || a.gameName.localeCompare(b.gameName));
    }, [metricsSummary14.byGame, localizedById]);

    const totals = useMemo(() => {
        const byGame = new Map();
        const overall = {
            rooms: rooms.length,
            devicesOnline: 0,
            devicesOffline: 0,
            devicesTotal: 0,
            playersOnline: 0,
            playersOffline: 0,
            playersTotal: 0,
        };

        for (const room of rooms) {
            overall.devicesOnline += room.devicesOnline;
            overall.devicesOffline += room.devicesOffline;
            overall.devicesTotal += room.devicesTotal;
            overall.playersOnline += room.playersOnline;
            overall.playersOffline += room.playersOffline;
            overall.playersTotal += room.playersTotal;

            const current = byGame.get(room.gameId) || {
                gameId: room.gameId,
                gameName: room.gameName,
                rooms: 0,
                devicesOnline: 0,
                devicesOffline: 0,
                devicesTotal: 0,
                playersOnline: 0,
                playersOffline: 0,
                playersTotal: 0,
            };
            current.rooms += 1;
            current.devicesOnline += room.devicesOnline;
            current.devicesOffline += room.devicesOffline;
            current.devicesTotal += room.devicesTotal;
            current.playersOnline += room.playersOnline;
            current.playersOffline += room.playersOffline;
            current.playersTotal += room.playersTotal;
            byGame.set(room.gameId, current);
        }

        return {
            overall,
            byGame: Array.from(byGame.values()).sort((a, b) => a.gameName.localeCompare(b.gameName)),
        };
    }, [rooms]);

    const writeConfigPatch = useCallback(async (patch) => {
        await update(ref(db), {
            ...patch,
            [`${APP_CONFIG_PATH}/updatedAt`]: Date.now(),
        });
    }, []);

    const toggleGameCreation = useCallback(async (gameId, enabled) => {
        await writeConfigPatch({
            [`${APP_CONFIG_PATH}/games/${gameId}/roomCreationEnabled`]: enabled,
            [`${APP_CONFIG_PATH}/games/${gameId}/roomJoinEnabled`]: enabled,
        });
        setStatus(enabled ? t('cms.gameEnabled') : t('cms.gameDisabled'));
    }, [t, writeConfigPatch]);

    const toggleGameJoin = useCallback(async (gameId, enabled) => {
        await writeConfigPatch({
            [`${APP_CONFIG_PATH}/games/${gameId}/roomJoinEnabled`]: enabled,
        });
        setStatus(enabled ? t('cms.joinEnabled') : t('cms.joinDisabled'));
    }, [t, writeConfigPatch]);

    const toggleCommand = useCallback(async (commandId, enabled) => {
        await writeConfigPatch({
            [`${APP_CONFIG_PATH}/commands/${commandId}`]: enabled,
        });
        setStatus(enabled ? t('cms.commandEnabled') : t('cms.commandDisabled'));
    }, [t, writeConfigPatch]);

    const saveBanner = useCallback(async (enabledOverride) => {
        const now = Date.now();
        const enabled = typeof enabledOverride === 'boolean' ? enabledOverride : bannerDraft.enabled;
        try {
            await update(ref(db), {
                [`${APP_CONFIG_PATH}/banner`]: {
                    enabled,
                    title: {
                        pl: bannerDraft.titlePl.trim(),
                        en: bannerDraft.titleEn.trim(),
                    },
                    body: {
                        pl: bannerDraft.bodyPl.trim(),
                        en: bannerDraft.bodyEn.trim(),
                    },
                    updatedAt: now,
                },
                [`${APP_CONFIG_PATH}/updatedAt`]: now,
            });
            setStatus(enabled ? t('cms.bannerSaved') : t('cms.bannerDisabled'));
        } catch (error) {
            console.error(error);
            setStatus(t('cms.bannerSaveError'));
        }
    }, [bannerDraft, t]);

    const buildCloseRoomUpdates = useCallback((roomId, roomData) => {
        const updates = {
            ...roomDeleteUpdates(roomId),
        };
        for (const player of Object.values(roomData?.players || {})) {
            if (player?.authUid) {
                updates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
            }
        }
        return updates;
    }, []);

    const closeRoom = useCallback(async (roomId) => {
        const room = roomMap.get(roomId);
        if (!room) return;
        try {
            await update(ref(db), buildCloseRoomUpdates(roomId, room.roomData));
            setStatus(t('cms.roomClosed', { roomId }));
            await refreshRooms();
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomActionError'));
        }
    }, [buildCloseRoomUpdates, refreshRooms, roomMap, t]);

    const closeAllRooms = useCallback(async () => {
        if (rooms.length === 0) {
            setStatus(t('cms.noActiveRooms'));
            return;
        }
        if (!window.confirm(t('cms.confirmCloseAllRooms', { count: rooms.length }))) {
            return;
        }
        const updates = {};
        for (const room of rooms) {
            Object.assign(updates, buildCloseRoomUpdates(room.roomId, room.roomData));
        }
        try {
            await update(ref(db), updates);
            setStatus(t('cms.allRoomsClosed', { count: rooms.length }));
            setSelectedRoomId('');
            await refreshRooms();
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomActionError'));
        }
    }, [buildCloseRoomUpdates, refreshRooms, rooms, t]);

    const closeRoomsForGame = useCallback(async (gameId) => {
        const targetRooms = rooms.filter((room) => room.gameId === gameId);
        if (targetRooms.length === 0) {
            setStatus(t('cms.noRoomsForGame'));
            return;
        }
        if (!window.confirm(t('cms.confirmCloseGameRooms', {
            count: targetRooms.length,
            game: localizedById.get(gameId)?.name || gameId,
        }))) {
            return;
        }
        const updates = {};
        for (const room of targetRooms) {
            Object.assign(updates, buildCloseRoomUpdates(room.roomId, room.roomData));
        }
        try {
            await update(ref(db), updates);
            setStatus(t('cms.gameRoomsClosed', { count: targetRooms.length }));
            await refreshRooms();
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomActionError'));
        }
    }, [buildCloseRoomUpdates, localizedById, refreshRooms, rooms, t]);

    const kickPlayer = useCallback(async (roomId, playerId) => {
        const room = roomMap.get(roomId);
        const player = room?.players.find((entry) => entry.id === playerId);
        if (!player) return;
        if (!window.confirm(t('cms.confirmKickPlayer', {
            name: player.name || playerId,
            roomId,
        }))) {
            return;
        }
        try {
            await remove(ref(db, `rooms/${roomId}/players/${playerId}`));
            if (player.authUid) {
                await remove(ref(db, `${PRESENCE_INDEX_ROOT}/${player.authUid}`));
            }
            setStatus(t('cms.playerKicked', { name: player.name || playerId }));
            await refreshRooms();
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomActionError'));
        }
    }, [refreshRooms, roomMap, t]);

    const transferHost = useCallback(async (roomId, playerId) => {
        const room = roomMap.get(roomId);
        const player = room?.players.find((entry) => entry.id === playerId);
        if (!room || !player) return;
        const updates = {};
        for (const row of room.players) {
            updates[`rooms/${roomId}/players/${row.id}/isHost`] = row.id === playerId;
        }
        try {
            await update(ref(db), updates);
            setStatus(t('cms.hostChanged', { name: player.name || playerId }));
            await refreshRooms();
        } catch (error) {
            console.error(error);
            setStatus(t('cms.roomActionError'));
        }
    }, [refreshRooms, roomMap, t]);

    const clearRoom = useCallback(async (roomId) => {
        const room = roomMap.get(roomId);
        if (!room) return;
        const now = Date.now();
        const roomData = room.roomData;
        const joinMode = normalizeJoinMode(roomData);
        const admission = normalizeAdmission(roomData);
        const showCode = showRoomCodeInList(roomData);

        await update(ref(db), {
            [`rooms/${roomId}`]: {
                gameId: roomData.gameId,
                joinMode,
                admission,
                showCodeInList: showCode,
                ...(roomData.passwordHash ? { passwordHash: roomData.passwordHash } : {}),
                createdAt: roomData.createdAt || now,
                gameState: null,
                settings: null,
                roleHistory: null,
                players: null,
                joinRequests: null,
            },
            [roomPublicPath(roomId)]: buildRoomPublicEntry({
                gameId: roomData.gameId,
                joinMode,
                admission,
                onlineCount: 0,
                pendingCount: 0,
                showCodeInList: showCode,
                updatedAt: now,
            }),
        });
        setStatus(t('admin.clearDone', { roomId }));
        await refreshRooms();
    }, [refreshRooms, roomMap, t]);

    const runConsoleCommand = useCallback(async (rawCommand) => {
        const raw = String(rawCommand || '').trim();
        const command = raw.toUpperCase();
        if (!raw) return;
        if (!isAdminCommandEnabled(cmsConfig, raw)) {
            setStatus(t('cms.commandBlocked'));
            return;
        }

        try {
            if (command === 'HELP') {
                setStatus(t('admin.helpText'));
                return;
            }

            if (command === 'RESET' || command === 'PURGE' || command === 'PURGE ROOMS') {
                const confirmKey = command === 'RESET'
                    ? 'admin.confirmReset'
                    : command === 'PURGE'
                        ? 'admin.confirmPurge'
                        : 'admin.confirmPurgeRooms';
                const doneKey = command === 'RESET'
                    ? 'admin.resetDone'
                    : command === 'PURGE'
                        ? 'admin.purgeDone'
                        : 'admin.purgeRoomsDone';
                if (!window.confirm(t(confirmKey))) return;
                await update(ref(db), roomsPurgeAllUpdates());
                setStatus(t(doneKey));
                await refreshRooms();
                return;
            }

            if (command === 'PURGE PLAYERS') {
                if (!window.confirm(t('admin.confirmPurgePlayers'))) return;
                const snapshot = await get(ref(db, 'rooms'));
                const updates = {};
                for (const roomId of Object.keys(snapshot.val() || {})) {
                    updates[`rooms/${roomId}/players`] = null;
                }
                if (Object.keys(updates).length > 0) {
                    await update(ref(db), updates);
                }
                setStatus(t('admin.purgePlayersDone'));
                await refreshRooms();
                return;
            }

            if (command === 'CLEAR') {
                if (!selectedRoomId) {
                    setStatus(t('admin.clearNeedsRoom'));
                    return;
                }
                await clearRoom(selectedRoomId);
                return;
            }

            if (command === 'REVEAL') {
                if (!selectedRoom) {
                    setStatus(t('admin.revealNeedsRoom'));
                    return;
                }
                if (!['impostor', 'mafia'].includes(selectedRoom.gameId)) {
                    setStatus(t('admin.revealWrongGame'));
                    return;
                }
                await update(ref(db, `rooms/${selectedRoomId}/gameState`), { revealAllRoles: true });
                setStatus(t('admin.revealDone'));
                return;
            }

            if (command === 'SYNC') {
                if (!selectedRoom) {
                    setStatus(t('admin.gameSyncNeedsRoom'));
                    return;
                }
                if (selectedRoom.gameId === 'telepathy') {
                    const { updates, result } = await buildTelepathySyncUpdates(selectedRoomId);
                    if (Object.keys(updates).length > 0) {
                        await update(ref(db), updates);
                    }
                    const syncMessages = {
                        revealed: 'admin.telepathySyncRevealed',
                        cleaned: 'admin.telepathySyncCleaned',
                        noop: 'admin.telepathySyncNoop',
                        not_started: 'admin.telepathySyncNotStarted',
                    };
                    setStatus(t(syncMessages[result] || 'admin.telepathySyncNoop', { roomId: selectedRoomId }));
                    return;
                }
                if (selectedRoom.gameId === 'just-one') {
                    const { updates, result } = await buildJustOneSyncUpdates(selectedRoomId);
                    if (Object.keys(updates).length > 0) {
                        await update(ref(db), updates);
                    }
                    const syncMessages = {
                        revealed: 'admin.justOneSyncRevealed',
                        cleaned: 'admin.justOneSyncCleaned',
                        noop: 'admin.justOneSyncNoop',
                        not_started: 'admin.justOneSyncNotStarted',
                    };
                    setStatus(t(syncMessages[result] || 'admin.justOneSyncNoop', { roomId: selectedRoomId }));
                    return;
                }
                setStatus(t('admin.gameSyncWrongGame'));
                return;
            }

            if (command === 'NEXT' || command === 'NEXT ROUND') {
                if (!selectedRoom) {
                    setStatus(t('admin.gameNextNeedsRoom'));
                    return;
                }
                if (selectedRoom.gameId === 'telepathy') {
                    if (!canAdvanceTelepathyRound(selectedRoom.roomData.gameState || {})) {
                        setStatus(t('admin.telepathyNextWrongPhase'));
                        return;
                    }
                    const playerIds = selectedRoom.players.map((player) => player.id);
                    const updates = await buildTelepathyAdvanceRoundUpdatesFromRoom(selectedRoomId, playerIds);
                    await update(ref(db), updates);
                    setStatus(t('admin.telepathyNextDone', { roomId: selectedRoomId }));
                    await refreshRooms();
                    return;
                }
                if (selectedRoom.gameId === 'just-one') {
                    if (!canAdvanceJustOneRound(selectedRoom.roomData.gameState || {})) {
                        setStatus(t('admin.justOneNextWrongPhase'));
                        return;
                    }
                    const updates = await buildJustOneAdvanceRoundUpdatesFromRoom(selectedRoomId);
                    if (!updates || Object.keys(updates).length === 0) {
                        setStatus(t('admin.justOneNextWrongPhase'));
                        return;
                    }
                    await update(ref(db), updates);
                    setStatus(t('admin.justOneNextDone', { roomId: selectedRoomId }));
                    await refreshRooms();
                    return;
                }
                setStatus(t('admin.gameNextWrongGame'));
                return;
            }

            if (command.startsWith('ADMIN KICK ')) {
                if (!selectedRoom) {
                    setStatus(t('admin.adminNeedsRoom'));
                    return;
                }
                const targetName = raw.slice(11).trim();
                const target = selectedRoom.players.find(
                    (player) => String(player.name || '').toLowerCase() === targetName.toLowerCase()
                );
                if (!target) {
                    setStatus(t('admin.playerNotFoundInRoom'));
                    return;
                }
                await kickPlayer(selectedRoomId, target.id);
                return;
            }

            if (command === 'HOST' || command.startsWith('HOST ')) {
                if (!selectedRoom) {
                    setStatus(t('admin.hostNeedsRoom'));
                    return;
                }
                const arg = raw.split(/\s+/).slice(1).join(' ').trim();
                if (!arg) {
                    setStatus(t('admin.hostUsage'));
                    return;
                }
                const target = selectedRoom.players.find(
                    (player) => String(player.name || '').toLowerCase() === arg.toLowerCase()
                );
                if (!target) {
                    setStatus(t('admin.playerNotFoundInRoom'));
                    return;
                }
                await transferHost(selectedRoomId, target.id);
                return;
            }

            setStatus(t('admin.unknownCommand'));
        } catch (error) {
            console.error(error);
            setStatus(t('admin.commandError'));
        }
    }, [clearRoom, cmsConfig, kickPlayer, refreshRooms, selectedRoom, selectedRoomId, t, transferHost]);

    const handleGoogleAuth = useCallback(async () => {
        setAuthBusy(true);
        setStatus('');
        try {
            const authModule = await import('../services/auth/firebaseAuth');
            await authModule.signInWithGoogle();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : t('cms.authError'));
        } finally {
            setAuthBusy(false);
        }
    }, [t]);

    const handleSignOut = useCallback(async () => {
        setAuthBusy(true);
        try {
            await signOut(firebaseAuth);
        } catch (error) {
            console.error(error);
            setStatus(t('cms.signOutError'));
        } finally {
            setAuthBusy(false);
        }
    }, [t]);

    if (!authUser) {
        return (
            <div className="app-shell cms-shell">
                <section className="cms-panel">
                    <h1>{t('cms.title')}</h1>
                    <p>{t('cms.loginLead')}</p>
                    <button type="button" onClick={() => void handleGoogleAuth()} disabled={authBusy}>
                        {t('cms.loginGoogle')}
                    </button>
                    {status ? <p className="error-message">{status}</p> : null}
                </section>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="app-shell cms-shell">
                <section className="cms-panel">
                    <h1>{t('cms.title')}</h1>
                    <p>{t('cms.accessDenied')}</p>
                    <p className="join-progress">{authUser.email || authUser.uid}</p>
                    <button type="button" onClick={() => void handleSignOut()} disabled={authBusy}>
                        {t('cms.signOut')}
                    </button>
                    {status ? <p className="error-message">{status}</p> : null}
                </section>
            </div>
        );
    }

    return (
        <div className="app-shell cms-shell">
            <section className="cms-panel">
                <div className="cms-header">
                    <div>
                        <h1>{t('cms.title')}</h1>
                        <p className="join-progress">{t('cms.loggedAs', { email: authUser.email || authUser.uid })}</p>
                    </div>
                    <div className="cms-header__actions">
                        <button type="button" className="btn-link" onClick={() => void refreshRooms()} disabled={roomsLoading}>
                            {roomsLoading ? t('cms.refreshing') : t('cms.refresh')}
                        </button>
                        <button type="button" className="btn-link" onClick={() => void refreshMetrics()} disabled={metricsLoading}>
                            {metricsLoading ? t('cms.statsRefreshing') : t('cms.statsRefresh')}
                        </button>
                        <button type="button" className="btn-link" onClick={() => void handleSignOut()} disabled={authBusy}>
                            {t('cms.signOut')}
                        </button>
                    </div>
                </div>

                {status ? <p className="cms-status" role="status">{status}</p> : null}

                <div className="cms-sections">
                    <CmsAccordionSection
                        title={t('cms.currentSummary')}
                        hint={t('cms.lastRefresh', {
                            time: roomsLoadedAt ? new Date(roomsLoadedAt).toLocaleTimeString() : '—',
                        })}
                        meta={t('cms.roomsCount', { count: totals.overall.rooms })}
                    >
                        <ul className="cms-stat-list">
                            <li>{t('cms.roomsCount', { count: totals.overall.rooms })}</li>
                            <li>{t('cms.devicesSummary', { online: totals.overall.devicesOnline, offline: totals.overall.devicesOffline, total: totals.overall.devicesTotal })}</li>
                            <li>{t('cms.playersSummary', { online: totals.overall.playersOnline, offline: totals.overall.playersOffline, total: totals.overall.playersTotal })}</li>
                        </ul>
                        {totals.byGame.length > 0 && (
                            <div className="cms-subcards">
                                {totals.byGame.map((entry) => (
                                    <article key={entry.gameId} className="cms-subcard">
                                        <strong>{entry.gameName}</strong>
                                        <span>{t('cms.roomsCount', { count: entry.rooms })}</span>
                                        <span>{t('cms.devicesSummaryShort', { online: entry.devicesOnline, total: entry.devicesTotal })}</span>
                                        <span>{t('cms.playersSummaryShort', { online: entry.playersOnline, total: entry.playersTotal })}</span>
                                    </article>
                                ))}
                            </div>
                        )}
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.gamesTitle')}
                        hint={t('cms.gamesSectionHint')}
                        meta={String(sortedGames.length)}
                    >
                        <div className="cms-games cms-games--grid">
                            {sortedGames.map((game) => {
                                const state = game.cmsState;
                                return (
                                    <article key={game.id} className="cms-game-row">
                                        <div className="cms-game-row__head">
                                            <strong>{game.name}</strong>
                                            <p>{game.comingSoon ? t('cms.comingSoonLocked') : state.roomCreationEnabled ? t('cms.gameEnabledState') : t('cms.gameDisabledState')}</p>
                                        </div>
                                        {game.comingSoon ? (
                                            <span className="cms-badge">{t('common.soon')}</span>
                                        ) : (
                                            <div className="cms-toggle-pair">
                                                <button
                                                    type="button"
                                                    className={`settings-toggle ${state.roomCreationEnabled ? '' : 'settings-toggle--off'}`}
                                                    aria-pressed={state.roomCreationEnabled}
                                                    onClick={() => void toggleGameCreation(game.id, !state.roomCreationEnabled)}
                                                >
                                                    <span>{t('cms.allowNewRooms')}</span>
                                                    <span className={`settings-toggle__icon ${state.roomCreationEnabled ? 'on' : 'off'}`}>
                                                        {state.roomCreationEnabled ? '✓' : '–'}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`settings-toggle ${state.roomJoinEnabled ? '' : 'settings-toggle--off'}`}
                                                    aria-pressed={state.roomJoinEnabled}
                                                    disabled={!state.roomCreationEnabled}
                                                    onClick={() => void toggleGameJoin(game.id, !state.roomJoinEnabled)}
                                                >
                                                    <span>{t('cms.allowJoinExisting')}</span>
                                                    <span className={`settings-toggle__icon ${state.roomJoinEnabled ? 'on' : 'off'}`}>
                                                        {state.roomJoinEnabled ? '✓' : '–'}
                                                    </span>
                                                </button>
                                                <button type="button" className="btn-link" onClick={() => void closeRoomsForGame(game.id)}>
                                                    {t('cms.closeGameRooms')}
                                                </button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.statsTitle')}
                        hint={t('cms.statsHint', { days: METRICS_HISTORY_DAYS })}
                        meta={t('cms.statsLastRefresh', {
                            time: metricsLoadedAt ? new Date(metricsLoadedAt).toLocaleTimeString() : '—',
                        })}
                    >
                        <ul className="cms-stat-list">
                            <li>{t('cms.statsSummary7', {
                                devices: metricsSummary7.deviceJoins,
                                players: metricsSummary7.playerJoins,
                                games: metricsSummary7.gamesStarted,
                                rooms: metricsSummary7.roomsCreated,
                            })}</li>
                            <li>{t('cms.statsSummary14', {
                                devices: metricsSummary14.deviceJoins,
                                players: metricsSummary14.playerJoins,
                                games: metricsSummary14.gamesStarted,
                                rooms: metricsSummary14.roomsCreated,
                            })}</li>
                        </ul>
                        <div className="cms-metrics-table-wrap">
                            <table className="cms-metrics-table">
                                <thead>
                                    <tr>
                                        <th>{t('cms.statsColDay')}</th>
                                        <th>{t('cms.statsColDevices')}</th>
                                        <th>{t('cms.statsColPlayers')}</th>
                                        <th>{t('cms.statsColGames')}</th>
                                        <th>{t('cms.statsColRooms')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dailyMetrics.map((row) => (
                                        <tr key={row.dayKey}>
                                            <td>{row.label}</td>
                                            <td>{row.deviceJoins}</td>
                                            <td>{row.playerJoins}</td>
                                            <td>{row.gamesStarted}</td>
                                            <td>{row.roomsCreated}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {metricsByGame.length > 0 && (
                            <div className="cms-subcards">
                                {metricsByGame.map((row) => (
                                    <article key={row.gameId} className="cms-subcard">
                                        <strong>{row.gameName}</strong>
                                        <span>{t('cms.statsGameStarted', { count: row.gamesStarted })}</span>
                                        <span>{t('cms.statsGameRooms', { count: row.roomsCreated })}</span>
                                    </article>
                                ))}
                            </div>
                        )}
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.bannerTitle')}
                        hint={t('cms.bannerHint')}
                        meta={bannerDraft.enabled ? t('cms.bannerMetaOn') : t('cms.bannerMetaOff')}
                    >
                        <button
                            type="button"
                            className="settings-toggle"
                            aria-pressed={bannerDraft.enabled}
                            onClick={() => setBannerDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}
                        >
                            <span>{t('cms.bannerEnabled')}</span>
                            <span className={`settings-toggle__icon ${bannerDraft.enabled ? 'on' : 'off'}`}>
                                {bannerDraft.enabled ? '✓' : '–'}
                            </span>
                        </button>
                        <div className="cms-banner-form">
                            <div className="cms-banner-form__field">
                                <label htmlFor="cms-banner-title-pl">{t('cms.bannerTitlePl')}</label>
                                <input
                                    id="cms-banner-title-pl"
                                    type="text"
                                    maxLength={120}
                                    value={bannerDraft.titlePl}
                                    onChange={(event) => setBannerDraft((prev) => ({
                                        ...prev,
                                        titlePl: event.target.value,
                                    }))}
                                />
                            </div>
                            <div className="cms-banner-form__field">
                                <label htmlFor="cms-banner-title-en">{t('cms.bannerTitleEn')}</label>
                                <input
                                    id="cms-banner-title-en"
                                    type="text"
                                    maxLength={120}
                                    value={bannerDraft.titleEn}
                                    onChange={(event) => setBannerDraft((prev) => ({
                                        ...prev,
                                        titleEn: event.target.value,
                                    }))}
                                />
                            </div>
                            <div className="cms-banner-form__field">
                                <label htmlFor="cms-banner-body-pl">{t('cms.bannerBodyPl')}</label>
                                <textarea
                                    id="cms-banner-body-pl"
                                    maxLength={500}
                                    value={bannerDraft.bodyPl}
                                    onChange={(event) => setBannerDraft((prev) => ({
                                        ...prev,
                                        bodyPl: event.target.value,
                                    }))}
                                />
                            </div>
                            <div className="cms-banner-form__field">
                                <label htmlFor="cms-banner-body-en">{t('cms.bannerBodyEn')}</label>
                                <textarea
                                    id="cms-banner-body-en"
                                    maxLength={500}
                                    value={bannerDraft.bodyEn}
                                    onChange={(event) => setBannerDraft((prev) => ({
                                        ...prev,
                                        bodyEn: event.target.value,
                                    }))}
                                />
                            </div>
                        </div>
                        <div className="cms-quick-actions">
                            <button type="button" onClick={() => void saveBanner()}>
                                {t('cms.bannerSave')}
                            </button>
                            <button type="button" className="btn-link" onClick={() => void saveBanner(false)}>
                                {t('cms.bannerTurnOff')}
                            </button>
                        </div>
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.commandsTitle')}
                        hint={t('cms.commandsSectionHint')}
                        meta={t('cms.commandsMeta', {
                            count: CMS_COMMAND_TOGGLES.filter((cmd) => cmsConfig.commands?.[cmd.id] !== false).length,
                            total: CMS_COMMAND_TOGGLES.length,
                        })}
                    >
                        <div className="cms-games">
                            {CMS_COMMAND_TOGGLES.map((command) => (
                                <button
                                    key={command.id}
                                    type="button"
                                    className="settings-toggle"
                                    aria-pressed={cmsConfig.commands?.[command.id] !== false}
                                    onClick={() => void toggleCommand(command.id, cmsConfig.commands?.[command.id] === false)}
                                >
                                    <span>{t(command.labelKey)}</span>
                                    <span className={`settings-toggle__icon ${cmsConfig.commands?.[command.id] !== false ? 'on' : 'off'}`}>
                                        {cmsConfig.commands?.[command.id] !== false ? '✓' : '–'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.consoleTitle')}
                        hint={selectedRoomId ? t('cms.consoleRoomSelected', { roomId: selectedRoomId }) : t('cms.consoleNoRoom')}
                    >
                        <div className="cms-console">
                            <input
                                type="text"
                                value={commandInput}
                                onChange={(event) => setCommandInput(event.target.value)}
                                placeholder={t('cms.consolePlaceholder')}
                            />
                            <button
                                type="button"
                                onClick={() => void runConsoleCommand(commandInput)}
                                disabled={!commandInput.trim()}
                            >
                                {t('cms.runCommand')}
                            </button>
                        </div>
                        <div className="cms-quick-actions">
                            {['HELP', 'CLEAR', 'REVEAL', 'SYNC', 'NEXT', 'RESET'].map((cmd) => (
                                <button key={cmd} type="button" className="btn-link" onClick={() => void runConsoleCommand(cmd)}>
                                    {cmd}
                                </button>
                            ))}
                        </div>
                    </CmsAccordionSection>

                    <CmsAccordionSection
                        title={t('cms.roomsTitle')}
                        hint={t('cms.roomsSectionHint')}
                        meta={t('cms.roomsCount', { count: rooms.length })}
                    >
                        {rooms.length === 0 ? (
                            <p className="cms-empty">{t('cms.noActiveRooms')}</p>
                        ) : (
                            <>
                                <div className="cms-quick-actions cms-quick-actions--toolbar">
                                    <button type="button" className="btn-link btn-link--danger" onClick={() => void closeAllRooms()}>
                                        {t('cms.closeAllRooms')}
                                    </button>
                                </div>
                                <div className="cms-room-list">
                                {rooms.map((room) => (
                                    <CmsAccordionSection
                                        key={room.roomId}
                                        nested
                                        selected={selectedRoomId === room.roomId}
                                        title={room.gameName}
                                        hint={t('cms.roomHost', { name: room.hostName || '—' })}
                                        meta={`${room.roomId} · ${room.playersTotal}`}
                                    >
                                        <button
                                            type="button"
                                            className={`cms-room-select ${selectedRoomId === room.roomId ? 'cms-room-select--active' : ''}`}
                                            onClick={() => setSelectedRoomId(room.roomId)}
                                        >
                                            {t('cms.consoleRoomSelected', { roomId: room.roomId })}
                                        </button>
                                        <div className="cms-room-meta">
                                            <span>{t('cms.devicesSummaryShort', { online: room.devicesOnline, total: room.devicesTotal })}</span>
                                            <span>{t('cms.playersSummaryShort', { online: room.playersOnline, total: room.playersTotal })}</span>
                                        </div>
                                        <div className="cms-room-actions">
                                            <button type="button" className="btn-link" onClick={() => void clearRoom(room.roomId)}>
                                                {t('cms.clearRoom')}
                                            </button>
                                            <button type="button" className="btn-link" onClick={() => void closeRoom(room.roomId)}>
                                                {t('cms.closeRoom')}
                                            </button>
                                        </div>
                                        <div className="cms-player-list">
                                            {room.players.map((player) => (
                                                <div key={player.id} className="cms-player-row">
                                                    <span>
                                                        {player.name || player.id}
                                                        {player.isHost ? ` · ${t('cms.hostBadge')}` : ''}
                                                        {player.isGuest ? ` · ${t('cms.guestBadge')}` : ''}
                                                    </span>
                                                    <div className="cms-player-actions">
                                                        {!player.isGuest && (
                                                            <button type="button" className="btn-link" onClick={() => void transferHost(room.roomId, player.id)}>
                                                                {t('cms.makeHost')}
                                                            </button>
                                                        )}
                                                        <button type="button" className="btn-link" onClick={() => void kickPlayer(room.roomId, player.id)}>
                                                            {t('cms.kickPlayer')}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </CmsAccordionSection>
                                ))}
                            </div>
                            </>
                        )}
                    </CmsAccordionSection>
                </div>
            </section>
        </div>
    );
}

export default CmsApp;
