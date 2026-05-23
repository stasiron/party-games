import { useEffect } from 'react';
import { setPiGameSessionActive } from './rtdbThrottle';

/** Wyłącza ping RTDB na emulatorze, gdy trwa rozgrywka (odciążenie Maliny). */
export function usePiGameSession(active) {
    useEffect(() => {
        setPiGameSessionActive(Boolean(active));
        return () => setPiGameSessionActive(false);
    }, [active]);
}
