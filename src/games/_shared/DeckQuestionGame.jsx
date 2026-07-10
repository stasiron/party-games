import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { buildDeckFromContentMap } from '../../lib/gameContentUtils';
import { resolveNextDeckItemFromState } from '../../lib/deckStateUtils';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import { useCategorySelection } from '../../lib/useCategorySelection';
import { useLocale } from '../../locales/LocaleContext';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import AdminDeckControlPanel from '../../components/AdminDeckControlPanel';
import { HostShareOptions } from '../../components/RoomInviteQR';
import GameRoomExitBar from '../../components/GameRoomExitBar';
import GameHostResetButton from '../../components/GameHostResetButton';

/**
 * Wspólny szablon gier: kategorie → tasowana talia → nawigacja prev/next.
 */
export default function DeckQuestionGame({
    isHost,
    canManageRoom = isHost,
    onLeave,
    roomId,
    shareOptions,
    gameId,
    contentKey,
    getCategories,
    deckField = 'questions',
    renderInGameHint = null,
    questionClassName = 'nhie-question-text',
    deckHookOptions = {},
    lobbyProps = {},
    progressRenderer = null,
    questionRenderer = null,
    renderInGamePanels = null,
    onHostNext = null,
    nextButtonLabel = null,
    rootClassName = '',
    hasAdminPowers = false,
    myPlayerId = null,
    tablePlayers = [],
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

    const resolvedNextLabel = typeof nextButtonLabel === 'function'
        ? nextButtonLabel({ isLast: isLastQuestion })
        : (nextButtonLabel ?? (isLastQuestion ? t('gameUi.endGame') : t('gameUi.next')));
    const defaultProgress = t('gameUi.questionProgress', { current: currentIndex + 1, total: deckLength });
    const defaultQuestion = currentQuestion ?? t('common.loading');

    const nextDeckItem = useMemo(
        () => resolveNextDeckItemFromState(roomData, buildDeckFromCategoryIds, {
            indexKey: deckHookOptions.indexKey || 'currentQuestionIndex',
            legacyDeckKey: deckHookOptions.legacyDeckKey || 'shuffledQuestions',
        }),
        [roomData, buildDeckFromCategoryIds, deckHookOptions.indexKey, deckHookOptions.legacyDeckKey]
    );

    const deckSkipOptions = useMemo(
        () => ({
            indexKey: deckHookOptions.indexKey || 'currentQuestionIndex',
            legacyDeckKey: deckHookOptions.legacyDeckKey || 'shuffledQuestions',
        }),
        [deckHookOptions.indexKey, deckHookOptions.legacyDeckKey]
    );

    const previewContent = nextDeckItem != null ? (
        questionRenderer ? (
            questionRenderer(nextDeckItem, t)
        ) : (
            <h3 className={questionClassName}>{String(nextDeckItem)}</h3>
        )
    ) : (
        <p className="admin-next-preview__empty">{t('gameUi.showNextPreviewEnd')}</p>
    );

    return (
        <div className={rootClassName || undefined}>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t(`games.${gameId}.name`)}>
                        <GameRulesList gameId={gameId} />
                    </GameRules>

                    <GameCategoryLobby
                        gameId={gameId}
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

                    <AdminDeckControlPanel
                        roomData={roomData}
                        roomId={roomId}
                        gameId={gameId}
                        myPlayerId={myPlayerId}
                        tablePlayers={tablePlayers}
                        previewContent={previewContent}
                        deckSkipOptions={deckSkipOptions}
                    />

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
                            <GameHostResetButton
                                gameId={gameId}
                                canManageRoom={canManageRoom}
                                onLeave={onLeave}
                                onReset={forceResetTable}
                            />
                        </div>
                    )}
                </div>
            )}

            <GameRoomExitBar
                gameId={gameId}
                canManageRoom={canManageRoom}
                onLeave={onLeave}
                forceResetTable={forceResetTable}
            />
        </div>
    );
}
