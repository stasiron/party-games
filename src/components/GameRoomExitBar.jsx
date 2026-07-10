import ConfirmButton from './ConfirmButton';
import { useGameRoomExit } from '../lib/room/useGameRoomExit';

/**
 * Dolny pasek wyjścia — jeden komponent dla wszystkich gier.
 */
export default function GameRoomExitBar({
    gameId,
    canManageRoom,
    onLeave,
    forceResetTable = null,
    buttonClassName = '',
}) {
    const { handleExitClick, exitButtonLabel } = useGameRoomExit({
        gameId,
        canManageRoom,
        onLeave,
    });

    return (
        <div className="bottom-controls">
            <ConfirmButton
                onClick={() => void handleExitClick(forceResetTable)}
                text={exitButtonLabel}
                className={buttonClassName || undefined}
            />
        </div>
    );
}
