import { useCallback } from 'react';
import { ref } from 'firebase/database';
import { set } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { getDarkStoriesDifficulties } from '../../lib/gameContentUtils';
import { useLocale } from '../../locales/LocaleContext';
import DeckQuestionGame from '../_shared/DeckQuestionGame';

function DarkStories({ isHost, onLeave, roomId, shareOptions }) {
    const { t } = useLocale();

    const getCategories = useCallback(
        (section) => getDarkStoriesDifficulties(section),
        []
    );

    const fingerprintExtra = useCallback(
        (data) => (data.solutionRevealed ? '1' : '0'),
        []
    );

    const toggleSolutionRevealed = useCallback((roomData) => {
        set(
            ref(db, `rooms/${roomId}/gameState/solutionRevealed`),
            !roomData.solutionRevealed
        );
    }, [roomId]);

    return (
        <DeckQuestionGame
            isHost={isHost}
            onLeave={onLeave}
            roomId={roomId}
            shareOptions={shareOptions}
            gameId="dark-stories"
            contentKey="darkStories"
            getCategories={getCategories}
            deckField="stories"
            rootClassName="dark-stories"
            deckHookOptions={{
                indexKey: 'currentStoryIndex',
                legacyDeckKey: 'shuffledStories',
                extraStartFields: { solutionRevealed: false },
                fingerprintExtra,
            }}
            lobbyProps={{
                selectPrompt: t('gameLobby.selectDifficulties'),
            }}
            progressRenderer={({ currentIndex, deckLength }) =>
                `Historia ${currentIndex + 1} z ${deckLength}`}
            questionRenderer={(story) => (
                <>
                    <p className="ds-prompt-label">Zagadka</p>
                    <h3 className="ds-prompt-text">{story?.prompt ?? 'Ładowanie…'}</h3>
                </>
            )}
            onHostNext={({ currentIndex, deckLength, isLastQuestion, navigateToIndex }) => {
                if (isLastQuestion || currentIndex >= deckLength - 1) return;
                navigateToIndex(currentIndex + 1, { solutionRevealed: false });
            }}
            nextButtonLabel={({ isLast }) => (isLast ? 'Koniec historii' : 'Następna historia')}
            renderInGamePanels={({ roomData, currentQuestion, isHost: hostMode }) => (
                <>
                    {hostMode && currentQuestion?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--host">
                            <p className="ds-prompt-label">Rozwiązanie (tylko narrator)</p>
                            <p className="ds-solution-text">{currentQuestion.solution}</p>
                            <button
                                type="button"
                                onClick={() => toggleSolutionRevealed(roomData)}
                                className="btn-ds-reveal"
                            >
                                {roomData.solutionRevealed
                                    ? 'Ukryj rozwiązanie przed grupą'
                                    : 'Odsłoń rozwiązanie dla wszystkich'}
                            </button>
                        </div>
                    )}

                    {!hostMode && roomData.solutionRevealed && currentQuestion?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--revealed">
                            <p className="ds-prompt-label">Rozwiązanie</p>
                            <p className="ds-solution-text">{currentQuestion.solution}</p>
                        </div>
                    )}

                    {!hostMode && !roomData.solutionRevealed && (
                        <p className="ds-player-hint">
                            Zadawaj pytania Tak / Nie / Nieistotne. Narrator zna odpowiedź.
                        </p>
                    )}
                </>
            )}
        />
    );
}

export default DarkStories;
