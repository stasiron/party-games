import ConfirmButton from './ConfirmButton';
import GameRules from './GameRules';

/**
 * Szablon gry w przygotowaniu — podłącz w App.jsx po implementacji logiki.
 */
function ComingSoonGame({ title, onLeave, isHost }) {
    return (
        <div className="coming-soon-game">
            <GameRules title={title}>
                <p className="coming-soon-game__lead">
                    Ta gra jest w trakcie tworzenia i na razie nie jest dostępna w rozgrywce.
                </p>
            </GameRules>

            <div className="content-panel content-panel--dark coming-soon-game__panel">
                <p className="coming-soon-game__emoji" aria-hidden="true">
                    🚧
                </p>
                <h3 className="coming-soon-game__title">Wkrótce dostępne</h3>
                <p className="coming-soon-game__text">
                    Pracujemy nad pełną wersją. Tymczasem wybierz inną grę z menu głównego.
                </p>
            </div>

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={onLeave}
                    text={isHost ? 'Wróć do menu' : 'Wyjdź z pokoju'}
                />
            </div>
        </div>
    );
}

export default ComingSoonGame;
