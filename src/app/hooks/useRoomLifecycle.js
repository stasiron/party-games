import { useCallback, useEffect, useMemo } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { set, get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import {
    buildRoomPublicEntry,
    roomDeleteUpdates,
    roomPublicPath,
} from '../../lib/roomIndex';
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
} from '../../lib/roomAccess';
import {
    hashRoomPassword,
    verifyRoomPassword,
    isValidRoomPassword,
    MIN_ROOM_PASSWORD_LENGTH,
    MAX_ROOM_PASSWORD_LENGTH,
} from '../../lib/roomPassword';
import { isGameCreationEnabled, isGameJoinEnabled } from '../../lib/cmsConfig.js';
import { getComingSoonMessage, isGameComingSoon } from '../../lib/gameCatalog.js';
import { resolveGameId, isPlayableGameId } from '../../data/gameIds.js';
import { prefetchGameChunk } from '../../lib/prefetchGameChunk';
import { getJoinGraceMs } from '../../lib/lowPower';
import { recordRoomCreated, recordNewPlayerJoin } from '../../lib/appMetrics.js';
import { buildTelepathySyncUpdates } from '../../lib/telepathyState';
import { buildJustOneSyncUpdates } from '../../lib/justOneState';
import { PRESENCE_INDEX_ROOT, RATE_LIMITS_MS, LAST_ROOM_KEY } from '../constants';

export function useRoomLifecycle(deps) {
    const {
        accountNickname,
        authUser,
        cachedRoomRef,
        cmsConfig,
        gameContent,
        isHost,
        isJoined,
        myPlayerId,
        myJoinRequestId,
        playerName,
        roomAdmission,
        roomShowCodeInList,
        selectedGame,
        selectedGameType,
        guestRoomPassword,
        guestJoinViaInvite,
        guestPasswordGranted,
        joinRequestList,
        waitingForApproval,
        currentRoomJoinMode,
        lastKnownRoomId,
        effectiveIsHost,
        roomInviteUrl,
        isLeavingVoluntarily,
        isJoiningRef,
        isJoinedRef,
        myPlayerIdRef,
        joinGraceUntilRef,
        missingPlayerSinceRef,
        pendingJoinCountRef,
        showCodeInListRef,
        lastPlayersListFingerprintRef,
        lastPublicSyncFingerprintRef,
        isRateLimited,
        isAdminRateLimited,
        setSelectedGame,
        setSelectedGameType,
        setIsJoined,
        setIsHost,
        setMyPlayerId,
        setPlayersList,
        setNameError,
        setJoinStatus,
        setLastJoinResult,
        setGuestRoomPassword,
        setGuestPasswordError,
        setGuestPasswordGranted,
        setGuestJoinViaInvite,
        setCurrentRoomJoinMode,
        setRoomAdmission,
        setRoomShowCodeInList,
        setJoinRequestList,
        setWaitingForApproval,
        setMyJoinRequestId,
        setIsRoomLocked,
        setPlayerName,
        setLobbyMessage,
        setEntryRole,
        setHostRoomPassword,
        setShowAdminPanel,
        setShowAccountCenter,
        setAuthStatus,
        setLastKnownRoomId,
        runWithBusy,
        t,
    } = deps;

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
    return {
        leaveToLobby,
        updatePresenceIndex,
        clearPresenceIndex,
        completeGuestJoin,
        approveJoinRequest,
        rejectJoinRequest,
        approveAllJoinRequests,
        cycleRoomAdmission,
        toggleShowCodeInList,
        hostShareOptions,
        handleJoin,
        openRoomAsGuest,
        handleGuestRoomPassword,
        handleJoinLastKnownGame,
        createHostRoom,
        kickPlayer,
        adminKick,
        adminDeleteRoom,
        handleBackToMenu,
        handleCloseRoom,
        handleLeaveRoom,
    };
}
