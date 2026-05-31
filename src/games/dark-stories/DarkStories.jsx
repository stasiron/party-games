import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { set, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { buildDeckFromContentMap, getDarkStoriesDifficulties } from '../../lib/gameContentUtils';
import { useLocale } from '../../locales/LocaleContext';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { useCategorySelection } from '../../lib/useCategorySelection';

function DarkStories({ isHost, onLeave, roomId, shareOptions }) {
    const { gameContent, t } = useLocale();
    const section = gameContent.darkStories;

    const playableDifficulties = useMemo(
        () => getDarkStoriesDifficulties(section),
        [section]
    );

    const {
        selectedIds: selectedDifficulties,
        toggleId: toggleDifficulty,
        resetToAll: resetDifficultiesToAll,
    } = useCategorySelection(playableDifficulties);

    const buildDeckFromCategoryIds = useCallback(
        (categoryIds) => buildDeckFromContentMap(categoryIds, section?.stories),
        [section]
    );

    const getCategoryIds = useCallback(() => selectedDifficulties, [selectedDifficulties]);

    const fingerprintExtra = useCallback(
        (data) => (data.solutionRevealed ? '1' : '0'),
        []
    );

    const {
        roomData,
        deckLength: storyCount,
        currentQuestion: currentStory,
        currentIndex,
        startGame,
        forceResetTable,
        prevQuestion: prevStory,
        isLastQuestion: isLastStory,
    } = useShuffledQuestionDeck(roomId, {
        buildDeckFromCategoryIds,
        getCategoryIds,
        onResetCategories: resetDifficultiesToAll,
        indexKey: 'currentStoryIndex',
        legacyDeckKey: 'shuffledStories',
        extraStartFields: { solutionRevealed: false },
        fingerprintExtra,
    });

    const toggleSolutionRevealed = useCallback(() => {
        set(
            ref(db, `rooms/${roomId}/gameState/solutionRevealed`),
            !roomData.solutionRevealed
        );
    }, [roomData.solutionRevealed, roomId]);

    const navigateToStory = useCallback(
        (index) => {
            if (storyCount === 0) return;
            update(ref(db), {
                [`rooms/${roomId}/gameState/currentStoryIndex`]: index,
                [`rooms/${roomId}/gameState/solutionRevealed`]: false,
            });
        },
        [storyCount, roomId]
    );

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    return (
        <div className="dark-stories">
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.dark-stories.name')}>
                        <GameRulesList gameId="dark-stories" />
                    </GameRules>

                    <GameCategoryLobby
                        isHost={isHost}
                        categories={playableDifficulties}
                        selectedIds={selectedDifficulties}
                        onToggle={toggleDifficulty}
                        onStart={startGame}
                        selectPrompt={t('gameLobby.selectDifficulties')}
                        guestWaitMessage={t('gameLobby.waitForHostNarrator')}
                        shareOptions={shareOptions}
                    />
                </div>
            ) : (
                <div>
                    <p className="ds-progress-text">
                        Historia {currentIndex + 1} z {storyCount}
                    </p>

                    <div className="content-panel content-panel--dark">
                        <p className="ds-prompt-label">Zagadka</p>
                        <h3 className="ds-prompt-text">
                            {currentStory?.prompt ?? 'Ładowanie…'}
                        </h3>
                    </div>

                    {isHost && currentStory?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--host">
                            <p className="ds-prompt-label">Rozwiązanie (tylko narrator)</p>
                            <p className="ds-solution-text">{currentStory.solution}</p>
                            <button
                                type="button"
                                onClick={toggleSolutionRevealed}
                                className="btn-ds-reveal"
                            >
                                {roomData.solutionRevealed
                                    ? 'Ukryj rozwiązanie przed grupą'
                                    : 'Odsłoń rozwiązanie dla wszystkich'}
                            </button>
                        </div>
                    )}

                    {!isHost && roomData.solutionRevealed && currentStory?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--revealed">
                            <p className="ds-prompt-label">Rozwiązanie</p>
                            <p className="ds-solution-text">{currentStory.solution}</p>
                        </div>
                    )}

                    {!isHost && !roomData.solutionRevealed && (
                        <p className="ds-player-hint">
                            Zadawaj pytania Tak / Nie / Nieistotne. Narrator zna odpowiedź.
                        </p>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row ds-nav-buttons">
                                <button
                                    type="button"
                                    onClick={prevStory}
                                    disabled={currentIndex === 0}
                                    className={`btn-ds-prev ${currentIndex === 0 ? 'disabled' : ''}`}
                                >
                                    Cofnij
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (currentIndex < storyCount - 1) {
                                            navigateToStory(currentIndex + 1);
                                        }
                                    }}
                                    disabled={isLastStory}
                                    className="btn-ds-next"
                                >
                                    {isLastStory ? 'Koniec historii' : 'Następna historia'}
                                </button>
                            </div>
                            <HostShareOptions shareOptions={shareOptions} />
                            <ConfirmButton onClick={forceResetTable} text="Zresetuj stół" />
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? 'Zamknij pokój' : 'Wyjdź z pokoju'}
                />
            </div>
        </div>
    );
}

export default DarkStories;
