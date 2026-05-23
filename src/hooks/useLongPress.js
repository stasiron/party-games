import { useRef, useCallback } from 'react';

/**
 * Długie przytrzymanie (telefon) lub double-click zostaje osobno.
 */
export function useLongPress(onLongPress, { delayMs = 650 } = {}) {
    const timerRef = useRef(null);
    const firedRef = useRef(false);

    const clear = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const start = useCallback(() => {
        firedRef.current = false;
        clear();
        timerRef.current = setTimeout(() => {
            firedRef.current = true;
            onLongPress();
        }, delayMs);
    }, [onLongPress, delayMs, clear]);

    const end = useCallback(() => {
        clear();
    }, [clear]);

    return {
        onTouchStart: (e) => {
            if (e.touches.length > 1) return;
            start();
        },
        onTouchEnd: end,
        onTouchCancel: end,
        onTouchMove: () => {
            clear();
        },
        onContextMenu: (e) => {
            e.preventDefault();
        },
    };
}
