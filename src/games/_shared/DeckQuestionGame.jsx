import { useCallback, useMemo } from 'react';
import { buildDeckFromContentMap } from '../../lib/gameContentUtils';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import { useCategorySelection } from '../../lib/useCategorySelection';
import { useLocale } from '../../locales/LocaleContext';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import { HostShareOptions } from '../../components/RoomInviteQR';

/**
 * Wspólny szablon gier: kategorie → tasowana talia → nawigacja prev/next.
 * @param {{
 *   isHost: boolean,
 *   onLeave: () => void,
 *   roomId: string,
 *   shareOptions?: object,
 *   gameId: string,
 *   contentKey: string,
 *   getCategories: (section: object) => Array<{ id: string, label?: string }>,
 *   deckField?: string,
 *   hostLeaveLabelKey?: string,
 *   renderInGameHint?: React.ReactNode,
 *   questionClassName?: string,
 * }} props
 */
export default function DeckQuestionGame({
    isHost,
    onLeave,
    roomId,
    shareOptions,
    gameId,
    contentKey,
    getCategories,
    deckField = 'questions',
    hostLeaveLabelKey = 'comingSoon.backToMenu',
    renderInGameHint = null,
    questionClassName = 'nhie-question-text',
}) {
    const { gameContent, t } = useLocale();
    const section = gameContent[contentKey];

    const playableCategories = useMemo(
        () => getCategories(section),
        [getCategories, section]
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);

    const buildDeckFromCategoryIds = useCallback(
        (categoryIds) => buildDeckFromContentMap(categoryIds, section?.[deckField]),
        [section, deckField]
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
        metricsGameId: gameId,
    });

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t(`games.${gameId}.name`)}>
                        <GameRulesList gameId={gameId} />
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

                    {renderInGameHint}

                    <div className="content-panel content-panel--dark">
                        <h3 className={questionClassName}>
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
                    text={isHost ? t(hostLeaveLabelKey) : t('gameUi.leaveRoom')}
                />
            </div>
        </div>
    );
}
