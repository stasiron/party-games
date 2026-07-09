import { useCallback } from 'react';
import { ref, remove } from 'firebase/database';
import { get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import {
    buildRoomPublicEntry,
    roomPublicPath,
    roomsPurgeAllUpdates,
} from '../../lib/roomIndex';
import {
    normalizeJoinMode,
    normalizeAdmission,
    showRoomCodeInList,
} from '../../lib/roomAccess';
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
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val() || {};
                if (!roomData.gameId) {
                    alert(t('admin.clearRoomNotFound'));
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
                setLobbyMessage(t('admin.clearDone', { roomId: selectedGame }));
                finishAdminCommand();
                return;
            }

            if (cleanedCmd === 'RESET') {
                if (window.confirm(t('admin.confirmReset'))) {
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
                    setLobbyMessage(t('admin.resetDone'));
                    finishAdminCommand();
                }
                return;
            }

            if (cleanedCmd === 'PURGE') {
                if (window.confirm(t('admin.confirmPurge'))) {
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
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomData = roomSnap.val() || {};
                if (!['impostor', 'mafia'].includes(roomData.gameId)) {
                    alert(t('admin.revealWrongGame'));
                    return;
                }
                const revealUpdates = {
                    [`rooms/${selectedGame}/gameState/revealAllRoles`]: true,
                };
                if (
                    roomData.gameId === 'mafia'
                    && Number(roomData.gameState?.stateVersion) >= 2
                ) {
                    const hostOnlySnap = await get(ref(db, `rooms/${selectedGame}/hostOnly`));
                    const hostPlayers = hostOnlySnap.val()?.playersData || {};
                    const publicPlayers = roomData.gameState?.playersData || {};
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
                await update(ref(db), revealUpdates);
                setLobbyMessage(t('admin.revealDone'));
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
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomVal = roomSnap.val() || {};
                const roomGameId = roomVal.gameId;

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
                const roomSnap = await get(ref(db, `rooms/${selectedGame}`));
                const roomVal = roomSnap.val() || {};
                const roomGameId = roomVal.gameId;
                const gameState = roomVal.gameState || {};

                if (roomGameId === 'telepathy') {
                    if (!canAdvanceTelepathyRound(gameState)) {
                        alert(t('admin.telepathyNextWrongPhase'));
                        return;
                    }
                    const playerIds = Object.keys(roomVal.players || {}).filter(
                        (id) => roomVal.players[id] && roomVal.players[id].isKicked !== true
                    );
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
                    const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                    const data = snap.val() || {};
                    const targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === targetName.toLowerCase());
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
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};
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
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};

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
    }, [adminCommand, selectedGame, myPlayerId, isAdminMode, adminBypassEnabled, cmsConfig, runWithBusy, isAdminRateLimited, finishAdminCommand, t, adminBypassRef, setAdminCommand, setLobbyMessage, setIsAdminMode, setAdminBypassEnabled, setShowAdminPanel, lobbySetters]);

    return { handleAdminCommand };
}

