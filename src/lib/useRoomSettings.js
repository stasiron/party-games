import { useState, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

const RTDB_DEBOUNCE_MS = 80;

/**
 * Subscribes to `rooms/<roomId>/settings` and mirrors it in React state.
 */
export function useRoomSettings(roomId, defaultSettings) {
    const [settings, setSettings] = useState(defaultSettings);
    const defaultRef = useRef(defaultSettings);

    useEffect(() => {
        defaultRef.current = defaultSettings;
    }, [defaultSettings]);

    useEffect(() => {
        let timeoutId;
        let lastJson = '';
        if (!roomId) {
            setSettings(defaultRef.current);
            return undefined;
        }
        const settingsRef = ref(db, `rooms/${roomId}/settings`);
        const unsubscribe = onValue(settingsRef, (snapshot) => {
            const data = snapshot.val();
            const base = defaultRef.current;
            const next =
                data && typeof base === 'object'
                    ? { ...base, ...data }
                    : base;
            const json = JSON.stringify(next);
            if (json === lastJson) return;
            lastJson = json;

            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => setSettings(next), RTDB_DEBOUNCE_MS);
        });
        return () => {
            clearTimeout(timeoutId);
            unsubscribe();
        };
    }, [roomId]);

    return settings;
}
