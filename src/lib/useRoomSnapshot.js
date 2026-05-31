import { useEffect, useRef } from 'react';
import { ref, onValue, onDisconnect, remove } from 'firebase/database';
import { set, update } from './rtdb';
import { db } from './firebase';
import { getPlayersDebounceMs, getPresenceMissingGraceMs } from './lowPower';
import {
    normalizeJoinMode,
    normalizeAdmission,
    defaultShowCodeInList,
    getPendingJoinRequests,
} from './roomAccess';
import { fingerprintPlayersMap, playersMapToList } from './playerListFingerprint';

function fingerprintAdmission(roomOrVal) {
    return normalizeAdmission(typeof roomOrVal === 'object' ? roomOrVal : { admission: roomOrVal });
}

function fingerprintJoinMode(val) {
    return normalizeJoinMode({ joinMode: val });
}

function fingerprintShowCode(val, joinMode) {
    if (typeof val === 'boolean') return val ? '1' : '0';
    return defaultShowCodeInList(joinMode) ? '1' : '0';
}

function fingerprintJoinRequests(val) {
    return getPendingJoinRequests(val)
        .map((r) => `${r.id}:${r.status || 'pending'}:${r.requestedAt || 0}`)
        .join('|');
}

function fingerprintGameId(exists) {
    return exists ? '1' : '0';
}

/**
 * Jeden listener RTDB na cały pokój zamiast wielu równoległych onValue.
 */
export function useRoomSnapshot({
    roomId,
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
}) {
    const leaveToLobbyRef = useRef(leaveToLobby);
    const syncRoomPublicSummaryRef = useRef(syncRoomPublicSummary);
    const alertHostJoinRequestRef = useRef(alertHostJoinRequest);
    const clearPresenceIndexRef = useRef(clearPresenceIndex);
    const playJoinSoundRef = useRef(playJoinSound);
    const selectedGameTypeRef = useRef(selectedGameType);

    useEffect(() => {
        leaveToLobbyRef.current = leaveToLobby;
    }, [leaveToLobby]);
    useEffect(() => {
        syncRoomPublicSummaryRef.current = syncRoomPublicSummary;
    }, [syncRoomPublicSummary]);
    useEffect(() => {
        alertHostJoinRequestRef.current = alertHostJoinRequest;
    }, [alertHostJoinRequest]);
    useEffect(() => {
        clearPresenceIndexRef.current = clearPresenceIndex;
    }, [clearPresenceIndex]);
    useEffect(() => {
        playJoinSoundRef.current = playJoinSound;
    }, [playJoinSound]);
    useEffect(() => {
        selectedGameTypeRef.current = selectedGameType;
    }, [selectedGameType]);

    useEffect(() => {
        if (!roomId) return undefined;

        let playersTimeoutId;
        let lastPlayersFingerprint = '';
        const sectionFingerprints = {
            admission: '',
            joinMode: '',
            showCode: '',
            joinRequests: '',
            gameId: '',
        };

        const applyPlayersSnapshot = (data) => {
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                players: data,
                updatedAt: Date.now(),
            };
            const fp = fingerprintPlayersMap(data);
            if (fp === lastPlayersListFingerprintRef.current) return;
            lastPlayersListFingerprintRef.current = fp;

            const playersArray = playersMapToList(data);
            setPlayersList(playersArray);

            try {
                const newCount = playersArray.length;
                const prevCount = prevPlayersCountRef.current || 0;
                if (isHostRef.current && soundEnabledRef.current && prevCount > 0 && newCount > prevCount) {
                    playJoinSoundRef.current?.();
                }
                prevPlayersCountRef.current = newCount;
            } catch {
                /* join sound */
            }

            if (isHostRef.current && selectedGameTypeRef.current && !isLeavingVoluntarily.current) {
                syncRoomPublicSummaryRef.current?.(
                    roomId,
                    selectedGameTypeRef.current,
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
                onDisconnect(ref(db, `rooms/${roomId}/players/${pid}`)).cancel();
                const kickMessage = isLeavingVoluntarily.current
                    ? ''
                    : '⚠️ Zostałeś wyrzucony z pokoju przez Hosta.';
                leaveToLobbyRef.current?.({ message: kickMessage, keepEntryRole: true });
                void remove(ref(db, `rooms/${roomId}/players/${pid}`));
                const uid = authUserRef.current?.uid;
                if (uid) {
                    void clearPresenceIndexRef.current?.(uid);
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
                if (pastJoinGrace && pastMissingGrace && !isLeavingVoluntarily.current) {
                    leaveToLobbyRef.current?.({
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
                    set(ref(db, `rooms/${roomId}/players/${pid}/isOnline`), true);
                }
            } else {
                isOnlineHealSentRef.current = false;
            }
            setIsHost(myData.isHost || false);
        };

        const processPlayers = (rawPlayers) => {
            let data = rawPlayers || {};

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
                            updates[`rooms/${roomId}/players/${key}`] = null;
                        });
                        update(ref(db), updates);
                    }
                    data = { ...data };
                    zombieKeys.forEach((k) => {
                        delete data[k];
                    });
                }
            }

            const fp = fingerprintPlayersMap(data);
            if (fp === lastPlayersFingerprint) return;
            lastPlayersFingerprint = fp;

            clearTimeout(playersTimeoutId);
            const debounceMs = getPlayersDebounceMs();
            playersTimeoutId = setTimeout(() => {
                handlePresenceAndKick(data);
                applyPlayersSnapshot(data);
            }, debounceMs);
        };

        const handleAdmission = (val) => {
            const fp = fingerprintAdmission(val);
            if (fp === sectionFingerprints.admission) return;
            sectionFingerprints.admission = fp;
            const admission = normalizeAdmission({ admission: val });
            const locked = admission === 'closed';
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                admission,
                updatedAt: Date.now(),
            };
            setRoomAdmission(admission);
            setIsRoomLocked(locked);
            if (isHostRef.current && selectedGameTypeRef.current && !isLeavingVoluntarily.current) {
                syncRoomPublicSummaryRef.current?.(
                    roomId,
                    selectedGameTypeRef.current,
                    cachedRoomRef.current.players || {},
                    cachedRoomRef.current.joinMode,
                    admission,
                    pendingJoinCountRef.current
                );
            }
        };

        const handleJoinMode = (val) => {
            const fp = fingerprintJoinMode(val);
            if (fp === sectionFingerprints.joinMode) return;
            sectionFingerprints.joinMode = fp;
            const joinMode = normalizeJoinMode({ joinMode: val });
            cachedRoomRef.current = {
                ...cachedRoomRef.current,
                joinMode,
                updatedAt: Date.now(),
            };
            setCurrentRoomJoinMode(joinMode);
        };

        const handleShowCode = (val, joinMode) => {
            const fp = fingerprintShowCode(val, joinMode);
            if (fp === sectionFingerprints.showCode) return;
            sectionFingerprints.showCode = fp;
            const showCode =
                typeof val === 'boolean' ? val === true : defaultShowCodeInList(joinMode);
            showCodeInListRef.current = showCode;
            setRoomShowCodeInList(showCode);
        };

        const handleJoinRequests = (val) => {
            const fp = fingerprintJoinRequests(val);
            if (fp === sectionFingerprints.joinRequests) return;
            sectionFingerprints.joinRequests = fp;
            const pending = getPendingJoinRequests(val);
            pendingJoinCountRef.current = pending.length;
            setJoinRequestList(pending);
            if (isHostRef.current && selectedGameTypeRef.current && !isLeavingVoluntarily.current) {
                const newCount = pending.length;
                const prevCount = prevJoinRequestCountRef.current;
                if (newCount > prevCount) {
                    alertHostJoinRequestRef.current?.();
                }
                prevJoinRequestCountRef.current = newCount;
                syncRoomPublicSummaryRef.current?.(
                    roomId,
                    selectedGameTypeRef.current,
                    cachedRoomRef.current.players || {},
                    cachedRoomRef.current.joinMode,
                    cachedRoomRef.current.admission,
                    newCount
                );
            }
        };

        const handleGameId = (exists) => {
            const fp = fingerprintGameId(exists);
            if (fp === sectionFingerprints.gameId) return;
            sectionFingerprints.gameId = fp;
            if (exists) return;
            if (!isJoinedRef.current || isLeavingVoluntarily.current) return;
            if (Date.now() < joinGraceUntilRef.current) return;
            leaveToLobbyRef.current?.({
                message: '⚠️ Host zamknął pokój. Wrócono do ekranu wyboru.',
                keepEntryRole: true,
            });
        };

        const roomRef = ref(db, `rooms/${roomId}`);
        const unsubscribe = onValue(roomRef, (snapshot) => {
            if (!snapshot.exists()) {
                handleGameId(false);
                return;
            }
            const room = snapshot.val() || {};
            handleGameId(true);
            processPlayers(room.players);
            if ('admission' in room || 'isLocked' in room || room.admission !== undefined) {
                handleAdmission(normalizeAdmission(room));
            }
            handleJoinMode(room.joinMode);
            handleShowCode(
                room.showCodeInList,
                cachedRoomRef.current.joinMode || normalizeJoinMode(room)
            );
            handleJoinRequests(room.joinRequests);
        });

        return () => {
            clearTimeout(playersTimeoutId);
            unsubscribe();
        };
    }, [
        roomId,
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
        soundEnabledRef,
    ]);
}
