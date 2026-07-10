import { useLocale } from '../locales/LocaleContext';
import { getLobbyWaitMessage } from '../lib/room/gameRoomContract';

/** Tekst dla gościa w lobby — z gameRoomContract, nie z propsa gry. */
export default function GameLobbyGuestWait({ gameId, className = '' }) {
    const { t } = useLocale();
    return (
        <p className={className || undefined}>
            {getLobbyWaitMessage(t, gameId)}
        </p>
    );
}
