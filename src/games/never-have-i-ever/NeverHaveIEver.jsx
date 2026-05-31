import { useCallback, useMemo } from 'react';
import { buildDeckFromContentMap, getNeverHaveIEverCategories } from '../../lib/gameContentUtils';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { useCategorySelection } from '../../lib/useCategorySelection';
import { useLocale } from '../../locales/LocaleContext';

function NeverHaveIEver({ isHost, onLeave, roomId, shareOptions }) {
    const { gameContent, t } = useLocale();
    const section = gameContent.neverHaveIEver;

    const playableCategories = useMemo(
        () => getNeverHaveIEverCategories(section),
        [section]
    );
    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);

    const buildDeckFromCategoryIds = useCallback(
        (categoryIds) => buildDeckFromContentMap(categoryIds, section?.questions),
        [section]
    );
    const getCategoryIds = useCallback(() => selectedCategories, [selectedCategories]);

    const {
        roomData,
        deckLength,
        currentQuestion,
        currentIndex,
        startGame,
        forceResetTable,
        nextQuestion,
        prevQuestion,
        isLastQuestion,
        isFirstQuestion,
    } = useShuffledQuestionDeck(roomId, {
        buildDeckFromCategoryIds,
        getCategoryIds,
        onResetCategories: resetCategoriesToAll,
    });

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.never-have-i-ever.name')}>
                        <GameRulesList gameId="never-have-i-ever" />
                    </GameRules>

                    <GameCategoryLobby
                        isHost={isHost}
                        categories={playableCategories}
                        selectedIds={selectedCategories}
                        onToggle={toggleCategory}
                        onStart={startGame}
                        shareOptions={shareOptions}
                    />
                </div>
            ) : (
                <div>
                    <p className="nhie-progress-text">
                        {t('gameUi.questionProgress', { current: currentIndex + 1, total: deckLength })}
                    </p>
                    <div className="content-panel content-panel--dark">
                        <h3 className="nhie-question-text">
                            {currentQuestion ?? t('common.loading')}
                        </h3>
                    </div>

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row nhie-nav-buttons">
                                <button
                                    onClick={prevQuestion}
                                    disabled={isFirstQuestion}
                                    className={`btn-nhie-prev ${isFirstQuestion ? 'disabled' : ''}`}
                                >
                                    {t('gameUi.undo')}
                                </button>
                                <button
                                    onClick={nextQuestion}
                                    disabled={isLastQuestion}
                                    className="btn-nhie-next"
                                >
                                    {isLastQuestion ? t('gameUi.endGame') : t('gameUi.next')}
                                </button>
                            </div>
                            <HostShareOptions shareOptions={shareOptions} />
                            <ConfirmButton onClick={forceResetTable} text={t('gameUi.resetTable')} />
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? t('comingSoon.backToMenu') : t('gameUi.leaveRoom')}
                />
            </div>
        </div>
    );
}

export default NeverHaveIEver;
