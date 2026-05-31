import { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

const EMPTY_PRIVATE = Object.freeze({ isImpostor: false, word: null });

/**
 * Listener tylko na rooms/{roomId}/private/{playerId}.
 */
export function usePrivateGameState(roomId, playerId) {
    const [data, setData] = useState(null);

    useEffect(() => {
        if (!roomId || !playerId) {
            setData(null);
            return undefined;
        }
        const privateRef = ref(db, `rooms/${roomId}/private/${playerId}`);
        const unsubscribe = onValue(privateRef, (snapshot) => {
            setData(snapshot.val() || null);
        });
        return () => unsubscribe();
    }, [roomId, playerId]);

    return data;
}

/**
 * Host panel — rooms/{roomId}/hostOnly (tylko gdy enabled).
 */
export function useHostOnlyGameState(roomId, enabled) {
    const [data, setData] = useState(null);

    useEffect(() => {
        if (!roomId || !enabled) {
            setData(null);
            return undefined;
        }
        const hostRef = ref(db, `rooms/${roomId}/hostOnly`);
        const unsubscribe = onValue(hostRef, (snapshot) => {
            setData(snapshot.val() || null);
        });
        return () => unsubscribe();
    }, [roomId, enabled]);

    return data;
}

/**
 * Współdzielony telefon — listenery tylko na podane playerId (właściciel + goście).
 */
export function usePrivateRolesForPlayers(roomId, playerIds) {
    const [rolesById, setRolesById] = useState({});

    const stableKey = useMemo(
        () => [...new Set(playerIds.filter(Boolean))].sort().join(','),
        [playerIds]
    );

    useEffect(() => {
        const ids = stableKey ? stableKey.split(',') : [];
        if (!roomId || ids.length === 0) {
            setRolesById({});
            return undefined;
        }

        const unsubs = ids.map((playerId) => {
            const privateRef = ref(db, `rooms/${roomId}/private/${playerId}`);
            return onValue(privateRef, (snapshot) => {
                setRolesById((prev) => ({
                    ...prev,
                    [playerId]: snapshot.val() || EMPTY_PRIVATE,
                }));
            });
        });

        return () => {
            unsubs.forEach((unsub) => unsub());
        };
    }, [roomId, stableKey]);

    return rolesById;
}

export function getPrivateImpostorFlag(privateEntry) {
    return privateEntry?.isImpostor === true;
}

export function getPrivateWord(privateEntry) {
    const word = privateEntry?.word;
    return typeof word === 'string' && word.length > 0 ? word : null;
}
