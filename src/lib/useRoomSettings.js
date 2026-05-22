import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

/**
 * Subscribes to `rooms/<gameId>/settings` and mirrors it in React state.
 */
export function useRoomSettings(gameId, defaultSettings) {
    const [settings, setSettings] = useState(defaultSettings);

    useEffect(() => {
        let timeoutId;
        const settingsRef = ref(db, `rooms/${gameId}/settings`);
        const unsubscribe = onValue(settingsRef, (snapshot) => {
            const data = snapshot.val();
            const next =
                data && typeof defaultSettings === 'object'
                    ? { ...defaultSettings, ...data }
                    : defaultSettings;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => setSettings(next), 0);
        });
        return () => {
            clearTimeout(timeoutId);
            unsubscribe();
        };
    }, [gameId, defaultSettings]);

    return settings;
}
