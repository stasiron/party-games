import ConfirmButton from './ConfirmButton';
import GameRules from './GameRules';
import { useLocale } from '../locales/LocaleContext';
import GameRoomExitBar from './GameRoomExitBar';

function ComingSoonGame({ title, onLeave, isHost, gameId = 'coming-soon' }) {
    const { t } = useLocale();

    return (
        <div className="coming-soon-game">
            <GameRules title={title}>
                <p className="coming-soon-game__lead">
                    {t('comingSoon.inGameLead')}
                </p>
            </GameRules>

            <div className="content-panel content-panel--dark coming-soon-game__panel">
                <p className="coming-soon-game__emoji" aria-hidden="true">
                    🚧
                </p>
                <h3 className="coming-soon-game__title">{t('comingSoon.inGameTitle')}</h3>
                <p className="coming-soon-game__text">
                    {t('comingSoon.inGameText')}
                </p>
            </div>

            <GameRoomExitBar
                gameId={gameId}
                canManageRoom={isHost}
                onLeave={onLeave}
            />
        </div>
    );
}

export default ComingSoonGame;
