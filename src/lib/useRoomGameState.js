import { useState, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { getGameStateDebounceMs } from './lowPower';

/**
 * @param {string} gameId
 * @param {object} defaultState
 * @param {{ mergeDefaults?: boolean, getFingerprint?: (data: object | null) => string }} options
 * getFingerprint — lekkie porównanie (np. bez pul kart) gdy gracz czeka w kolejce.
 */
export function useRoomGameState(gameId, defaultState, { mergeDefaults = false, getFingerprint } = {}) {
    const [roomData, setRoomData] = useState(defaultState);
    const defaultRef = useRef(defaultState);
    const latestRef = useRef(defaultState);

    useEffect(() => {
        defaultRef.current = defaultState;
    }, [defaultState]);

    useEffect(() => {
        let timeoutId;
        let lastFingerprint = '';
        const debounceMs = getGameStateDebounceMs();
        const roomRef = ref(db, `rooms/${gameId}/gameState`);
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            const base = defaultRef.current;
            let next = base;
            if (data) {
                next =
                    mergeDefaults && typeof base === 'object'
                        ? { ...base, ...data }
                        : data;
            }
            latestRef.current = next;

            const fingerprint = getFingerprint
                ? getFingerprint(next)
                : JSON.stringify(next);
            if (fingerprint === lastFingerprint) return;
            lastFingerprint = fingerprint;

            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                setRoomData(latestRef.current);
            }, debounceMs);
        });
        return () => {
            clearTimeout(timeoutId);
            unsubscribe();
        };
    }, [gameId, mergeDefaults, getFingerprint]);

    return roomData;
}
