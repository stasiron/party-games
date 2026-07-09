import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
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
    deckHookOptions = {},
    lobbyProps = {},
    progressRenderer = null,
    questionRenderer = null,
    renderInGamePanels = null,
    onHostNext = null,
    nextButtonLabel = null,
    hostLeaveText = null,
    rootClassName = '',
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
        ...deckHookOptions,
    });

    const navigateToIndex = useCallback(
        (index, extraFields = {}) => {
            if (deckLength === 0) return;
            update(ref(db), {
                [`rooms/${roomId}/gameState/${deckHookOptions.indexKey || 'currentQuestionIndex'}`]: index,
                ...Object.fromEntries(
                    Object.entries(extraFields).map(([key, value]) => [
                        `rooms/${roomId}/gameState/${key}`,
                        value,
                    ])
                ),
            });
        },
        [deckHookOptions.indexKey, deckLength, roomId]
    );

    const handleHostNext = useCallback(() => {
        if (onHostNext) {
            onHostNext({
                currentIndex,
                deckLength,
                isLastQuestion,
                navigateToIndex,
                nextQuestion,
            });
            return;
        }
        nextQuestion();
    }, [onHostNext, currentIndex, deckLength, isLastQuestion, navigateToIndex, nextQuestion]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const resolvedNextLabel = typeof nextButtonLabel === 'function'
        ? nextButtonLabel({ isLast: isLastQuestion })
        : (nextButtonLabel ?? (isLastQuestion ? t('gameUi.endGame') : t('gameUi.next')));
    const defaultProgress = t('gameUi.questionProgress', { current: currentIndex + 1, total: deckLength });
    const defaultQuestion = currentQuestion ?? t('common.loading');

    return (
        <div className={rootClassName || undefined}>
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
                        {...lobbyProps}
                    />
                </div>
            ) : (
                <div>
                    <p className="nhie-progress-text">
                        {progressRenderer
                            ? progressRenderer({ currentIndex, deckLength, t })
                            : defaultProgress}
                    </p>

                    {renderInGameHint}

                    <div className="content-panel content-panel--dark">
                        {questionRenderer ? (
                            questionRenderer(currentQuestion, t)
                        ) : (
                            <h3 className={questionClassName}>{defaultQuestion}</h3>
                        )}
                    </div>

                    {renderInGamePanels?.({
                        roomData,
                        currentQuestion,
                        isHost,
                        roomId,
                        t,
                    })}

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
                                    onClick={handleHostNext}
                                    disabled={isLastQuestion}
                                    className="btn-nhie-next"
                                >
                                    {resolvedNextLabel}
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
                    text={isHost ? (hostLeaveText ?? t(hostLeaveLabelKey)) : t('gameUi.leaveRoom')}
                />
            </div>
        </div>
    );
}
