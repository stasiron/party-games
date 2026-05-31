import { useMemo } from 'react';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../lib/guestPlayers';
import { useLocale } from '../locales/LocaleContext';

/**
 * Nagłówek tury gracza — wspólny dla gier opartych o kolejkę (Prawda czy wyzwanie, Co wolisz?).
 */
function TurnHeader({
    currentPlayerName,
    playerName,
    tablePlayers = [],
    myPlayerId,
    title,
    titleExtra = null,
    onTitleDoubleClick,
    renderSharedPhoneBanner,
}) {
    const { t } = useLocale();
    const turnTitle = title ?? t('gameUi.turnHeader');
    const amICurrentPlayer = currentPlayerName?.trim() === playerName?.trim();
    const isGuestTurn = isCurrentPlayerGuest(tablePlayers, currentPlayerName);
    const isSharedPhoneTurn = isTurnForPhoneOwner(tablePlayers, myPlayerId, currentPlayerName);

    const sharedPhoneGuestName = useMemo(() => {
        if (!isGuestTurn || !isSharedPhoneTurn) return null;
        return currentPlayerName;
    }, [isGuestTurn, isSharedPhoneTurn, currentPlayerName]);

    return (
        <>
            <div className="turn-header">
                <h2
                    className="tod-turn-h2"
                    onDoubleClick={onTitleDoubleClick}
                >
                    {turnTitle}
                    {titleExtra}
                </h2>
                <h1 className={`tod-turn-h1 ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                    {currentPlayerName}
                    {amICurrentPlayer && ` (${t('gameUi.turnHeaderYou')})`}
                    {sharedPhoneGuestName && ` (${t('gameUi.guestPhoneHint')})`}
                </h1>
            </div>

            {sharedPhoneGuestName && isSharedPhoneTurn && renderSharedPhoneBanner?.(sharedPhoneGuestName)}
        </>
    );
}

export default TurnHeader;
