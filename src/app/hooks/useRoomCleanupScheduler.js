import { useEffect, useRef } from 'react';
import { ref } from 'firebase/database';
import { get as rtdbGet, runTransaction } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { ROOMS_PUBLIC_ROOT } from '../../lib/roomIndex';
import {
    BACKGROUND_CLEANUP_INTERVAL_MS,
    CLEANUP_LEASE_PATH,
    CLEANUP_LEASE_TTL_MS,
    ROOM_CLEANUP_COOLDOWN_MS,
    runRoomsCleanupFromSnapshots,
    cleanupOrphanRoomsPublicFromSnapshots,
    fetchRoomsForCleanup,
    shouldRunClientRoomsCleanup,
} from '../../lib/roomCleanup';

/** Background cleanup pokoi z lease — bez get(/rooms). */
export function useRoomCleanupScheduler({
    isJoined,
    effectiveIsHost,
    hasAdminPowers,
    selectedGame,
}) {
    const lastRoomsCleanupAtRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        const tabId = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const leaseOwner = `tab:${tabId}`;

        const tryCleanupNow = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            if (!shouldRunClientRoomsCleanup({ isJoined, effectiveIsHost, hasAdminPowers })) {
                return;
            }

            const leaseRef = ref(db, CLEANUP_LEASE_PATH);
            const now = Date.now();
            const leaseResult = await runTransaction(leaseRef, (current) => {
                const currentOwner = String(current?.owner || '');
                const expiresAt = Number(current?.expiresAt || 0);
                const leaseExpired = expiresAt <= now;
                const sameOwner = currentOwner === leaseOwner;
                if (!current || leaseExpired || sameOwner) {
                    return {
                        owner: leaseOwner,
                        expiresAt: now + CLEANUP_LEASE_TTL_MS,
                        updatedAt: now,
                    };
                }
                return undefined;
            }, { applyLocally: false });
            if (!leaseResult.committed || leaseResult.snapshot.val()?.owner !== leaseOwner) return;
            if (now - lastRoomsCleanupAtRef.current < ROOM_CLEANUP_COOLDOWN_MS) return;
            try {
                const publicSnap = await rtdbGet(ref(db, ROOMS_PUBLIC_ROOT));
                if (cancelled) return;
                const publicRaw = publicSnap.val() || {};
                const raw = await fetchRoomsForCleanup(publicRaw, selectedGame ? [selectedGame] : []);
                if (cancelled) return;
                const cleaned = await runRoomsCleanupFromSnapshots(raw, publicRaw, now);
                if (cleaned) lastRoomsCleanupAtRef.current = now;
                await cleanupOrphanRoomsPublicFromSnapshots(publicRaw, raw);
            } catch {
                /* best effort */
            }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                void tryCleanupNow();
            }
        };

        void tryCleanupNow();
        const intervalId = window.setInterval(() => {
            void tryCleanupNow();
        }, BACKGROUND_CLEANUP_INTERVAL_MS);
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [isJoined, effectiveIsHost, hasAdminPowers, selectedGame]);
}
