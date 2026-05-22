import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

/**
 * Subscribes to `rooms/<gameId>/gameState` and mirrors it in React state.
 * Defers setState to avoid cascading render warnings from RTDB callbacks.
 * Pass a stable `defaultState` (e.g. from useMemo) when possible.
 */
export function useRoomGameState(gameId, defaultState, { mergeDefaults = false } = {}) {
    const [roomData, setRoomData] = useState(defaultState);

    useEffect(() => {
        let timeoutId;
        const roomRef = ref(db, `rooms/${gameId}/gameState`);
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            let next = defaultState;
            if (data) {
                next =
                    mergeDefaults && typeof defaultState === 'object'
                        ? { ...defaultState, ...data }
                        : data;
            }
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => setRoomData(next), 0);
        });
        return () => {
            clearTimeout(timeoutId);
            unsubscribe();
        };
    }, [gameId, mergeDefaults, defaultState]);

    return roomData;
}
