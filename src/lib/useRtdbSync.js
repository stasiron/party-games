import { useEffect, useMemo, useState } from 'react';
import { getMinUiSyncMs } from './lowPower';
import { subscribePiQueue } from './rtdbThrottle';

/**
 * Opcje synchronizacji RTDB na Pi + flaga zajętości kolejki zapisów.
 */
export function useRtdbSync() {
    const [rtdbBusy, setRtdbBusy] = useState(false);
    const syncOpts = useMemo(() => ({ minUiMs: getMinUiSyncMs() }), []);

    useEffect(() => subscribePiQueue((depth) => setRtdbBusy(depth > 0)), []);

    return { rtdbBusy, syncOpts };
}
