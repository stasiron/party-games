import { useState, useEffect, useRef } from 'react';
import { ref } from 'firebase/database';
import { db } from './firebase';
import { get } from './rtdb';
import { isLowPowerDevice } from './lowPower';
import { subscribePiGameSession } from './rtdbThrottle';

const PING_INTERVAL_MS = 5000;
const PING_INTERVAL_LOW_POWER_LOBBY_MS = 8000;
const PING_PATH = 'rooms/__ping__';
const SLOW_PING_MS = 280;

/**
 * Co kilka sekund mierzy RTT do RTDB.
 */
export function useConnectionPing(enabled = true) {
    const [pingMs, setPingMs] = useState(null);
    const [pingError, setPingError] = useState(false);
    const [isPinging, setIsPinging] = useState(false);
    const [gameSessionActive, setGameSessionActive] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => subscribePiGameSession(setGameSessionActive), []);

    useEffect(() => {
        const lowPower = isLowPowerDevice();
        const pingAllowed =
            enabled &&
            (!lowPower || !gameSessionActive);
        if (!pingAllowed || typeof window === 'undefined') return undefined;

        const intervalMs = lowPower
            ? PING_INTERVAL_LOW_POWER_LOBBY_MS
            : PING_INTERVAL_MS;
        let timeoutId;
        let inFlight = false;
        let active = true;

        const measure = async () => {
            if (!mountedRef.current || !active || inFlight) return;
            inFlight = true;
            setIsPinging(true);
            const t0 = performance.now();
            try {
                await get(ref(db, PING_PATH));
                if (mountedRef.current) {
                    setPingMs(Math.round(performance.now() - t0));
                    setPingError(false);
                }
            } catch {
                if (mountedRef.current) {
                    setPingError(true);
                    setPingMs(null);
                }
            } finally {
                if (mountedRef.current) setIsPinging(false);
                inFlight = false;
                if (active) {
                    timeoutId = window.setTimeout(measure, intervalMs);
                }
            }
        };

        measure();
        return () => {
            active = false;
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [enabled, gameSessionActive]);

    const isSlow = pingError || (pingMs !== null && pingMs >= SLOW_PING_MS);

    return { pingMs, pingError, isPinging, isSlow, slowThresholdMs: SLOW_PING_MS };
}
