import { useCallback, useEffect, useRef } from 'react';
import { isTurnForPhoneOwner } from './guestPlayers';

/**
 * Wibracja przy zmianie tury — tylko dla właściciela telefonu, raz na gracza.
 */
export function useTurnVibration({
    currentPlayerName,
    tablePlayers,
    myPlayerId,
    vibrationEnabled,
    durationMs = 120,
}) {
    const lastVibratedTurnRef = useRef('');

    useEffect(() => {
        lastVibratedTurnRef.current = '';
    }, [currentPlayerName]);

    const triggerVibration = useCallback(() => {
        if (!vibrationEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
            return;
        }
        try {
            navigator.vibrate(durationMs);
        } catch {
            /* vibrate API */
        }
    }, [vibrationEnabled, durationMs]);

    useEffect(() => {
        if (!vibrationEnabled || !currentPlayerName) return;
        if (!isTurnForPhoneOwner(tablePlayers, myPlayerId, currentPlayerName)) return;
        const turnKey = currentPlayerName.trim();
        if (lastVibratedTurnRef.current === turnKey) return;
        lastVibratedTurnRef.current = turnKey;
        triggerVibration();
    }, [currentPlayerName, tablePlayers, myPlayerId, triggerVibration, vibrationEnabled]);
}
