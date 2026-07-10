import { useCallback } from 'react';
import { ref, remove } from 'firebase/database';
import { get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import {
    buildRoomPublicEntry,
    roomPublicPath,
    roomsPurgeAllUpdates,
} from '../../lib/roomIndex';
import { isAdminCommandEnabled } from '../../lib/cmsConfig.js';
import {
    buildTelepathyAdvanceRoundUpdatesFromRoom,
    buildTelepathySyncUpdates,
    canAdvanceTelepathyRound,
} from '../../lib/telepathyState';
import {
    buildJustOneAdvanceRoundUpdatesFromRoom,
    buildJustOneSyncUpdates,
    canAdvanceJustOneRound,
} from '../../lib/justOneState';
import { RATE_LIMITS_MS } from '../constants';
import { roomSecretWipePaths } from '../../lib/room/roomSecrets';
import { fetchRoomMeta } from '../../lib/room/roomMetaFetch';
import {
    isAdminDeckControlGame,
    buildShowCommandUpdates,
    PUPPET_MODE_STATE_KEY,
    PUPPET_OPERATOR_STATE_KEY,
} from '../../lib/adminDeckControls';

function resetLobbySession(setters) {
    setters.setSelectedGame(null);
    setters.setSelectedGameType(null);
    setters.setEntryRole(null);
    setters.setManualRoomCode('');
    setters.setActiveRooms([]);
    setters.setPlayersList([]);
    setters.setIsJoined(false);
    setters.setIsHost(false);
    setters.setMyPlayerId(null);
    setters.setNameError('');
    setters.setJoinStatus('');
    setters.setLastJoinResult('');
}

export function useAdminCommands({
    adminCommand,
    selectedGame,
    selectedGameType,
    myPlayerId,
    playersList = [],
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
}) {
    const lobbySetters = {
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
    };

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
        if (!isBypassToggle && !isHelp && !isAdminCommandEnabled(cmsConfig, rawCmd)) {
            setLobbyMessage(t('cms.commandBlocked'));
            setAdminCommand('');
            return;
        }

        await runWithBusy(async () => {
        try {
            if (['RESET', 'PURGE', 'PURGE PLAYERS', 'PURGE ROOMS', 'CLEAR'].includes(cleanedCmd)) {
                if (isAdminRateLimited('admin:destructive', RATE_LIMITS_MS.adminDestructive)) {
                    setLobbyMessage(t('admin.rateLimitDestructive'));
                    return;
                }
            }
            if (
                cleanedCmd === 'REVEAL' ||
                cleanedCmd === 'SHOW' ||
                cleanedCmd === 'PUPPET ON' ||
                cleanedCmd === 'PUPPET OFF' ||
                cleanedCmd === 'NEXT' ||
                cleanedCmd === 'NEXT ROUND' ||
                cleanedCmd === 'SYNC' ||
                cleanedCmd === 'HOST' ||
                cleanedCmd.startsWith('HOST ') ||
                cleanedCmd.startsWith('ADMIN ')
            ) {
                if (isAdminRateLimited('admin:mutation', RATE_LIMITS_MS.adminMutation)) {
                    setLobbyMessage(t('admin.rateLimitMutation'));
                    return;
                }
            }

            if (cleanedCmd === 'CLEAR') {
                if (!selectedGame) {
                    alert(t('admin.clearNeedsRoom'));
                    return;
                }
                const meta = await fetchRoomMeta(selectedGame);
                if (!meta?.gameId) {
                    alert(t('admin.clearRoomNotFound'));
                    return;
                }
                const now = Date.now();
                await update(ref(db), {
                    [`rooms/${selectedGame}`]: {
                        gameId: meta.gameId,
                        joinMode: meta.joinMode,
                        admission: meta.admission,
                        showCodeInList: meta.showCodeInList,
                        ...(meta.passwordHash ? { passwordHash: meta.passwordHash } : {}),
                        createdAt: meta.createdAt || now,
                        gameState: null,
                        settings: null,
                        roleHistory: null,
                        players: null,
                        joinRequests: null,
                    },
                    ...roomSecretWipePaths(selectedGame),
                    [roomPublicPath(selectedGame)]: buildRoomPublicEntry({
                        gameId: meta.gameId,
                        joinMode: meta.joinMode,
                        admission: meta.admission,
                        onlineCount: 0,
                        pendingCount: 0,
                        showCodeInList: meta.showCodeInList,
                        updatedAt: now,
                    }),
                });
                setLobbyMessage(t('admin.clearDone', { roomId: selectedGame }));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'RESET') {
                if (window.confirm(t('admin.confirmReset'))) {
                    await update(ref(db), roomsPurgeAllUpdates());
                    resetLobbySession(lobbySetters);
                    setLobbyMessage(t('admin.resetDone'));
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE') {
                if (window.confirm(t('admin.confirmPurge'))) {
                    await update(ref(db), roomsPurgeAllUpdates());
                    resetLobbySession(lobbySetters);
                    setLobbyMessage(t('admin.purgeDone'));
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE PLAYERS') {
                if (window.confirm(t('admin.confirmPurgePlayers'))) {
                    const publicSnap = await get(ref(db, 'roomsPublic'));
                    const roomIds = new Set(Object.keys(publicSnap.val() || {}));
                    if (selectedGame) roomIds.add(selectedGame);
                    const purgePlayersUpdates = {};
                    roomIds.forEach((roomId) => {
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
                    setLobbyMessage(t('admin.purgePlayersDone'));
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE ROOMS') {
                if (window.confirm(t('admin.confirmPurgeRooms'))) {
                    await update(ref(db), roomsPurgeAllUpdates());
                    resetLobbySession(lobbySetters);
                    setLobbyMessage(t('admin.purgeRoomsDone'));
                    finishAdminCommand();
                }
                return;
            }

            // ADMIN shortcuts: 'ADMIN' toggles admin mode, or 'ADMIN KICK <name>' to target
            if (cleanedCmd === 'ADMIN') {
                const newState = !isAdminMode;
                setIsAdminMode(newState);
                setLobbyMessage(newState ? t('admin.adminModeOn') : t('admin.adminModeOff'));
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
                    alert(t('admin.revealNeedsRoom'));
                    return;
                }
                const roomGameId = selectedGameType || (await fetchRoomMeta(selectedGame))?.gameId;
                if (!['impostor', 'mafia'].includes(roomGameId)) {
                    alert(t('admin.revealWrongGame'));
                    return;
                }
                const revealUpdates = {
                    [`rooms/${selectedGame}/gameState/revealAllRoles`]: true,
                };
                if (roomGameId === 'mafia') {
                    const [stateVersionSnap, hostOnlySnap, publicPlayersSnap] = await Promise.all([
                        get(ref(db, `rooms/${selectedGame}/gameState/stateVersion`)),
                        get(ref(db, `rooms/${selectedGame}/hostOnly`)),
                        get(ref(db, `rooms/${selectedGame}/gameState/playersData`)),
                    ]);
                    if (Number(stateVersionSnap.val()) >= 2) {
                        const hostPlayers = hostOnlySnap.val()?.playersData || {};
                        const publicPlayers = publicPlayersSnap.val() || {};
                        Object.entries(hostPlayers).forEach(([pid, entry]) => {
                            if (!entry?.role) return;
                            const alive = publicPlayers[pid]?.isAlive !== false;
                            revealUpdates[`rooms/${selectedGame}/gameState/playersData/${pid}`] = {
                                name: entry.name || publicPlayers[pid]?.name || '',
                                role: entry.role,
                                isAlive: alive,
                            };
                        });
                    }
                }
                await update(ref(db), revealUpdates);
                setLobbyMessage(t('admin.revealDone'));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'SHOW') {
                if (!selectedGame) {
                    alert(t('admin.showNeedsRoom'));
                    return;
                }
                if (!myPlayerId) {
                    alert(t('admin.deckControlNeedsPlayer'));
                    return;
                }
                const roomGameId = selectedGameType || (await fetchRoomMeta(selectedGame))?.gameId;
                if (!isAdminDeckControlGame(roomGameId)) {
                    alert(t('admin.showWrongGame'));
                    return;
                }
                const gameStateSnap = await get(ref(db, `rooms/${selectedGame}/gameState`));
                const gameState = gameStateSnap.val();
                if (!gameState?.isGameStarted) {
                    alert(t('admin.showNotStarted'));
                    return;
                }
                await update(ref(db), buildShowCommandUpdates(selectedGame, roomGameId, gameState, myPlayerId));
                setLobbyMessage(t('admin.showDone', { roomId: selectedGame }));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'PUPPET ON' || cleanedCmd === 'PUPPET OFF') {
                if (!selectedGame) {
                    alert(t('admin.puppetNeedsRoom'));
                    return;
                }
                const roomGameId = selectedGameType || (await fetchRoomMeta(selectedGame))?.gameId;
                if (!isAdminDeckControlGame(roomGameId)) {
                    alert(t('admin.puppetWrongGame'));
                    return;
                }
                const gameStateSnap = await get(ref(db, `rooms/${selectedGame}/gameState`));
                const gameState = gameStateSnap.val();
                if (!gameState?.isGameStarted) {
                    alert(t('admin.puppetNotStarted'));
                    return;
                }

                const turningOn = cleanedCmd === 'PUPPET ON';
                if (turningOn && !myPlayerId) {
                    alert(t('admin.deckControlNeedsPlayer'));
                    return;
                }
                const updates = {
                    [`rooms/${selectedGame}/gameState/${PUPPET_MODE_STATE_KEY}`]: turningOn,
                };
                if (turningOn) {
                    updates[`rooms/${selectedGame}/gameState/${PUPPET_OPERATOR_STATE_KEY}`] = myPlayerId;
                } else {
                    updates[`rooms/${selectedGame}/gameState/${PUPPET_OPERATOR_STATE_KEY}`] = null;
                }
                await update(ref(db), updates);
                setLobbyMessage(t(turningOn ? 'admin.puppetOnDone' : 'admin.puppetOffDone', {
                    roomId: selectedGame,
                }));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'HELP') {
                setLobbyMessage(t('admin.helpText'));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'SYNC') {
                if (!selectedGame) {
                    alert(t('admin.gameSyncNeedsRoom'));
                    return;
                }
                const roomGameId = selectedGameType;

                if (roomGameId === 'telepathy') {
                    const { updates, result } = await buildTelepathySyncUpdates(selectedGame);
                    if (Object.keys(updates).length > 0) {
                        await update(ref(db), updates);
                    }
                    const syncMessages = {
                        revealed: 'admin.telepathySyncRevealed',
                        cleaned: 'admin.telepathySyncCleaned',
                        noop: 'admin.telepathySyncNoop',
                        not_started: 'admin.telepathySyncNotStarted',
                    };
                    setLobbyMessage(t(syncMessages[result] || 'admin.telepathySyncNoop', {
                        roomId: selectedGame,
                    }));
                } else if (roomGameId === 'just-one') {
                    const { updates, result } = await buildJustOneSyncUpdates(selectedGame);
                    if (Object.keys(updates).length > 0) {
                        await update(ref(db), updates);
                    }
                    const syncMessages = {
                        revealed: 'admin.justOneSyncRevealed',
                        cleaned: 'admin.justOneSyncCleaned',
                        noop: 'admin.justOneSyncNoop',
                        not_started: 'admin.justOneSyncNotStarted',
                    };
                    setLobbyMessage(t(syncMessages[result] || 'admin.justOneSyncNoop', {
                        roomId: selectedGame,
                    }));
                } else {
                    alert(t('admin.gameSyncWrongGame'));
                    return;
                }
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'NEXT' || cleanedCmd === 'NEXT ROUND') {
                if (!selectedGame) {
                    alert(t('admin.gameNextNeedsRoom'));
                    return;
                }
                const roomGameId = selectedGameType;
                const gameStateSnap = await get(ref(db, `rooms/${selectedGame}/gameState`));
                const gameState = gameStateSnap.val() || {};

                if (roomGameId === 'telepathy') {
                    if (!canAdvanceTelepathyRound(gameState)) {
                        alert(t('admin.telepathyNextWrongPhase'));
                        return;
                    }
                    const playerIds = playersList
                        .filter((p) => p?.isKicked !== true)
                        .map((p) => p.id)
                        .filter(Boolean);
                    const updates = await buildTelepathyAdvanceRoundUpdatesFromRoom(
                        selectedGame,
                        playerIds
                    );
                    await update(ref(db), updates);
                    setLobbyMessage(t('admin.telepathyNextDone', { roomId: selectedGame }));
                } else if (roomGameId === 'just-one') {
                    if (!canAdvanceJustOneRound(gameState)) {
                        alert(t('admin.justOneNextWrongPhase'));
                        return;
                    }
                    const updates = await buildJustOneAdvanceRoundUpdatesFromRoom(selectedGame);
                    if (!updates || Object.keys(updates).length === 0) {
                        alert(t('admin.justOneNextWrongPhase'));
                        return;
                    }
                    await update(ref(db), updates);
                    setLobbyMessage(t('admin.justOneNextDone', { roomId: selectedGame }));
                } else {
                    alert(t('admin.gameNextWrongGame'));
                    return;
                }
                finishAdminCommand();
                return;
            }

            if (cleanedCmd.startsWith('ADMIN ')) {
                if (!selectedGame) {
                    alert(t('admin.adminNeedsRoom'));
                    return;
                }
                const sub = rawCmd.slice(6).trim(); // keep case for names
                if (sub.toUpperCase().startsWith('KICK ')) {
                    const targetName = sub.slice(5).trim();
                    if (!targetName) {
                        alert(t('admin.kickNameRequired'));
                        return;
                    }
                    const data = playersList.length > 0
                        ? Object.fromEntries(playersList.map((p) => [p.id, p]))
                        : (await get(ref(db, `rooms/${selectedGame}/players`))).val() || {};
                    const targetKey = Object.keys(data).find(
                        (k) => String(data[k]?.name || '').toLowerCase() === targetName.toLowerCase()
                    );
                    if (!targetKey) {
                        alert(t('admin.playerNotFoundInRoom'));
                        return;
                    }
                    const target = data[targetKey];
                    // Admin wyrzuca natychmiast, niezależnie od stanu isOnline
                    await remove(ref(db, `rooms/${selectedGame}/players/${targetKey}`));
                    setLobbyMessage(t('admin.kickedPlayer', { name: target.name || targetKey }));
                    finishAdminCommand();
                    return;
                }
                alert(t('admin.unknownAdminSubcommand'));
                return;
            }

            // HOST transfer: HOST <name> or HOST ME or simple HOST -> make caller host
            if (cleanedCmd === 'HOST') {
                if (!selectedGame) {
                    alert(t('admin.hostNeedsRoom'));
                    return;
                }
                if (!myPlayerId) {
                    alert(t('admin.hostMustJoin'));
                    return;
                }
                const data = playersList.length > 0
                    ? Object.fromEntries(playersList.map((p) => [p.id, p]))
                    : (await get(ref(db, `rooms/${selectedGame}/players`))).val() || {};
                if (!data[myPlayerId]) {
                    alert(t('admin.hostPlayerMissing'));
                    return;
                }
                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${myPlayerId}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(t('admin.hostTransferredSelf', { name: data[myPlayerId]?.name || myPlayerId }));
                finishAdminCommand();
                return;
            }

            // HOST transfer: HOST <name> or HOST ME
            if (cleanedCmd.startsWith('HOST')) {
                if (!selectedGame) {
                    alert(t('admin.hostNeedsRoom'));
                    return;
                }
                const arg = rawCmd.split(/\s+/).slice(1).join(' ').trim();
                if (!arg) {
                    alert(t('admin.hostUsage'));
                    return;
                }
                const data = playersList.length > 0
                    ? Object.fromEntries(playersList.map((p) => [p.id, p]))
                    : (await get(ref(db, `rooms/${selectedGame}/players`))).val() || {};

                let targetKey = null;
                if (arg.toUpperCase() === 'ME') {
                    if (!myPlayerId) {
                        alert(t('admin.hostMeNotInRoom'));
                        return;
                    }
                    targetKey = myPlayerId;
                } else {
                    targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === arg.toLowerCase());
                    if (!targetKey) {
                        alert(t('admin.playerNotFoundInRoom'));
                        return;
                    }
                }

                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${targetKey}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(t('admin.hostTransferred', { name: data[targetKey]?.name || targetKey }));
                finishAdminCommand();
                return;
            }

            alert(t('admin.unknownCommand'));
        } catch (e) {
            console.error(e);
            alert(t('admin.commandError'));
        }
        });
    }, [adminCommand, selectedGame, selectedGameType, myPlayerId, playersList, isAdminMode, adminBypassEnabled, cmsConfig, runWithBusy, isAdminRateLimited, finishAdminCommand, t, adminBypassRef, setAdminCommand, setLobbyMessage, setIsAdminMode, setAdminBypassEnabled, setShowAdminPanel, lobbySetters]);

    return { handleAdminCommand };
}

