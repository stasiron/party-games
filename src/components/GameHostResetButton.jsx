import { useGameRoomExit } from '../lib/room/useGameRoomExit';
import ConfirmButton from './ConfirmButton';

/** Przycisk resetu rundy w panelu hosta — etykieta z gameRoomContract. */
export default function GameHostResetButton({
    gameId,
    canManageRoom,
    onLeave,
    onReset,
    busy = false,
    buttonClassName = '',
}) {
    const { resetRoundLabel } = useGameRoomExit({
        gameId,
        canManageRoom,
        onLeave,
    });

    return (
        <ConfirmButton
            onClick={() => void onReset()}
            text={resetRoundLabel}
            disabled={busy}
            className={buttonClassName || undefined}
        />
    );
}
