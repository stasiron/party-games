import { useCallback, useMemo } from 'react';
import { useLocale } from '../../locales/LocaleContext';
import {
    getRoomExitLabels,
    shouldResetBeforeClose,
} from './gameRoomContract';

/**
 * Wyjście z gry — etykiety i akcja z gameRoomContract (gameId).
 */
export function useGameRoomExit({
    gameId,
    canManageRoom,
    onLeave,
}) {
    const { t } = useLocale();

    const labels = useMemo(
        () => getRoomExitLabels(t, gameId, canManageRoom),
        [t, gameId, canManageRoom]
    );

    const resetBeforeClose = useMemo(
        () => shouldResetBeforeClose(gameId),
        [gameId]
    );

    const endSessionAndExit = useCallback(async (resetGameState) => {
        if (typeof resetGameState === 'function') {
            await resetGameState();
        }
        onLeave();
    }, [onLeave]);

    const handleExitClick = useCallback(async (forceResetTable) => {
        if (canManageRoom && resetBeforeClose && typeof forceResetTable === 'function') {
            await endSessionAndExit(forceResetTable);
            return;
        }
        onLeave();
    }, [canManageRoom, resetBeforeClose, endSessionAndExit, onLeave]);

    return {
        canManageRoom,
        labels,
        exitButtonLabel: labels.exit,
        resetRoundLabel: labels.resetRound,
        resetBeforeClose,
        endSessionAndExit,
        handleExitClick,
        onLeave,
    };
}
