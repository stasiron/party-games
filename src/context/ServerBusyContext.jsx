import { createContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useConnectionPing } from '../lib/useConnectionPing';
import { isLowPowerDevice } from '../lib/lowPower';
import { subscribePiQueue } from '../lib/rtdbThrottle';

export const ServerBusyContext = createContext(null);

export function ServerBusyProvider({ children }) {
    const [busyCount, setBusyCount] = useState(0);
    const [piQueueDepth, setPiQueueDepth] = useState(0);
    const ping = useConnectionPing(true);

    useEffect(() => subscribePiQueue(setPiQueueDepth), []);

    const runWithBusy = useCallback(async (fn) => {
        setBusyCount((c) => c + 1);
        try {
            return await fn();
        } finally {
            setBusyCount((c) => Math.max(0, c - 1));
        }
    }, []);

    const piSyncing = isLowPowerDevice() && piQueueDepth > 0;
    const showSpinner = busyCount > 0 || ping.pingError || piSyncing;
    const busyLabel = piSyncing
        ? 'Synchronizacja z Maliną'
        : 'Łączenie z serwerem';

    const value = useMemo(
        () => ({
            ...ping,
            busyCount,
            piQueueDepth,
            showSpinner,
            runWithBusy,
        }),
        [ping, busyCount, piQueueDepth, showSpinner, runWithBusy]
    );

    return (
        <ServerBusyContext.Provider value={value}>
            {children}
            {showSpinner && (
                <div className="server-busy" role="status" aria-live="polite" aria-label={busyLabel}>
                    <span className="server-busy__orb" aria-hidden="true" />
                </div>
            )}
        </ServerBusyContext.Provider>
    );
}
