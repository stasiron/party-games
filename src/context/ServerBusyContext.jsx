import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useConnectionPing } from '../lib/useConnectionPing';
import { isLowPowerDevice } from '../lib/lowPower';
import { subscribePiQueue } from '../lib/rtdbThrottle';
import { RunWithBusyContext, ConnectionPingContext } from './ServerBusyContext';

export function ServerBusyProvider({ children }) {
    const [busyCount, setBusyCount] = useState(0);
    const [piQueueDepth, setPiQueueDepth] = useState(0);
    const ping = useConnectionPing();
    const pingRef = useRef(ping);

    useEffect(() => {
        pingRef.current = ping;
    }, [ping]);

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

    const busyValue = useMemo(
        () => ({
            busyCount,
            piQueueDepth,
            showSpinner,
            runWithBusy,
            getPingSnapshot: () => pingRef.current,
        }),
        [busyCount, piQueueDepth, showSpinner, runWithBusy]
    );

    return (
        <ConnectionPingContext.Provider value={ping}>
            <RunWithBusyContext.Provider value={busyValue}>
                {children}
                {showSpinner && (
                    <div className="server-busy" role="status" aria-live="polite" aria-label={busyLabel}>
                        <span className="server-busy__orb" aria-hidden="true" />
                    </div>
                )}
            </RunWithBusyContext.Provider>
        </ConnectionPingContext.Provider>
    );
}
