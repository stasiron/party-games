import { useState, useEffect, useRef, useCallback } from 'react';
import { ref } from 'firebase/database';
import { db } from './firebase';
import { get } from './rtdb';
import { isLowPowerDevice, shouldConserveNetwork } from './lowPower';
import { subscribePiGameSession } from './rtdbThrottle';
import { isContinuousPingEnabled, UI_SETTINGS_KEY } from './uiSettings';

const PING_INTERVAL_MS = 5000;
const PING_INTERVAL_PI_LOBBY_MS = 30 * 1000;
const PING_PATH = 'rooms/__ping__';
const SLOW_PING_MS = 280;

async function measurePingOnce(setPingMs, setPingError, setIsPinging, mountedRef) {
    if (!mountedRef.current) return;
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
    }
}

/**
 * Mierzy RTT do RTDB. Domyślnie bez stałego interwału — tylko na żądanie lub gdy użytkownik włączy w ustawieniach.
 */
export function useConnectionPing() {
    const [pingMs, setPingMs] = useState(null);
    const [pingError, setPingError] = useState(false);
    const [isPinging, setIsPinging] = useState(false);
    const [gameSessionActive, setGameSessionActive] = useState(false);
    const [prefsVersion, setPrefsVersion] = useState(0);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => subscribePiGameSession(setGameSessionActive), []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const bump = () => setPrefsVersion((v) => v + 1);
        const onStorage = (event) => {
            if (event.key === UI_SETTINGS_KEY) bump();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('partyGames:uiSettings', bump);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('partyGames:uiSettings', bump);
        };
    }, []);

    const measureOnce = useCallback(async () => {
        await measurePingOnce(setPingMs, setPingError, setIsPinging, mountedRef);
    }, []);

    useEffect(() => {
        const lowPower = isLowPowerDevice();
        const conserve = shouldConserveNetwork();
        const continuousEnabled = isContinuousPingEnabled() && !conserve;
        const pingAllowed =
            continuousEnabled &&
            typeof window !== 'undefined' &&
            (!lowPower || !gameSessionActive);

        if (!pingAllowed) return undefined;

        const intervalMs = lowPower ? PING_INTERVAL_PI_LOBBY_MS : PING_INTERVAL_MS;
        let timeoutId;
        let inFlight = false;
        let active = true;

        const measure = async () => {
            if (!mountedRef.current || !active || inFlight) return;
            inFlight = true;
            await measurePingOnce(setPingMs, setPingError, setIsPinging, mountedRef);
            inFlight = false;
            if (active && mountedRef.current) {
                timeoutId = window.setTimeout(measure, intervalMs);
            }
        };

        measure();
        return () => {
            active = false;
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [gameSessionActive, prefsVersion]);

    const isSlow = pingError || (pingMs !== null && pingMs >= SLOW_PING_MS);

    return {
        pingMs,
        pingError,
        isPinging,
        isSlow,
        slowThresholdMs: SLOW_PING_MS,
        measureOnce,
        continuousPingActive: isContinuousPingEnabled() && !shouldConserveNetwork(),
    };
}
