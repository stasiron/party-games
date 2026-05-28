import { useContext } from 'react';
import { ServerBusyContext } from './ServerBusyContext.jsx';

export function useServerBusy() {
    const ctx = useContext(ServerBusyContext);
    if (!ctx) {
        throw new Error('useServerBusy must be used within ServerBusyProvider');
    }
    return ctx;
}
