import { useEffect } from 'react';
import { ref } from 'firebase/database';
import { update } from './rtdb';
import { db } from './firebase';
import { getHeartbeatIntervalMs, getHiddenHeartbeatIntervalMs } from './lowPower';

/**
 * Okresowy heartbeat isOnline/lastSeenAt — rzadszy w tle i w trybie oszczędnym.
 */
export function usePlayerHeartbeat({ isJoined, roomId, myPlayerId }) {
    useEffect(() => {
        if (!isJoined || !roomId || !myPlayerId || typeof document === 'undefined') {
            return undefined;
        }

        const playerRef = ref(db, `rooms/${roomId}/players/${myPlayerId}`);
        let intervalId;

        const touchPresence = () => {
            update(playerRef, { isOnline: true, lastSeenAt: Date.now() }).catch(() => {
                /* best effort heartbeat */
            });
        };

        const schedule = () => {
            window.clearInterval(intervalId);
            const ms = document.hidden
                ? getHiddenHeartbeatIntervalMs()
                : getHeartbeatIntervalMs();
            intervalId = window.setInterval(touchPresence, ms);
        };

        touchPresence();
        schedule();

        const onVisibility = () => {
            if (!document.hidden) {
                touchPresence();
            }
            schedule();
        };

        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [isJoined, roomId, myPlayerId]);
}
