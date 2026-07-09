import { useContext } from 'react';
import { RunWithBusyContext, ConnectionPingContext } from './ServerBusyContext';

export function useRunWithBusy() {
    const ctx = useContext(RunWithBusyContext);
    if (!ctx) {
        throw new Error('useRunWithBusy must be used within ServerBusyProvider');
    }
    return ctx;
}

export function useConnectionPingContext() {
    const ctx = useContext(ConnectionPingContext);
    if (!ctx) {
        throw new Error('useConnectionPingContext must be used within ServerBusyProvider');
    }
    return ctx;
}
