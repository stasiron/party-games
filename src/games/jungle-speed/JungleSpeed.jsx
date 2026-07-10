import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { db } from '../../lib/firebase';
import { set, update } from '../../lib/rtdb';
import { recordGameStarted } from '../../lib/appMetrics.js';
import { useLocale } from '../../locales/LocaleContext';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { useRtdbSync } from '../../lib/useRtdbSync';
import { getTablePlayers, getPlayerNameById } from '../../lib/guestPlayers';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameHostResetButton from '../../components/GameHostResetButton';
import GameRoomExitBar from '../../components/GameRoomExitBar';
import { HostShareOptions } from '../../components/RoomInviteQR';
import {
    appendCardsToHiddenDeck,
    buildCardIndex,
    buildJungleDeck,
    collectFaceUpCards,
    createFaceUpClearedPlayersState,
    evaluateTotemSuggestion,
    findWinnerId,
    nextTurnId,
    pickFirstMatchReceiver,
    splitDeckForPlayers,
} from './engine';
import JungleCardFace from './JungleCardFace';

const DEFAULT_STATE = {
    isGameStarted: false,
    isStopped: false,
    winnerId: null,
    turnPlayerId: null,
    turnOrderIds: [],
    cardDeck: [],
    playersState: {},
    pendingTotem: null,
    lastResolution: null,
};

function JungleSpeed({
    isHost,
    canManageRoom = isHost,
    onLeave,
    gameId = 'jungle-speed',
    myPlayerId,
    tablePlayers = [],
    roomId,
    shareOptions,
}) {
    const { t } = useLocale();
    const { syncOpts, rtdbBusy } = useRtdbSync();
    const roomData = useRoomGameState(roomId, DEFAULT_STATE, { mergeDefaults: true });
    const gameStarted = roomData.isGameStarted === true;
    const stopped = roomData.isStopped === true;

    const activePlayers = useMemo(
        () => getTablePlayers(tablePlayers).filter((p) => p?.id && !p.isKicked),
        [tablePlayers]
    );

    const playerNameById = useMemo(
        () => new Map(activePlayers.map((p) => [p.id, p.name || p.id])),
        [activePlayers]
    );

    const cardIndex = useMemo(() => buildCardIndex(roomData.cardDeck || []), [roomData.cardDeck]);

    const currentPlayerName = getPlayerNameById(activePlayers, roomData.turnPlayerId) || '—';
    const isGameOver = Boolean(roomData.winnerId);
    const myState = roomData.playersState?.[myPlayerId];
    const myTopCard = cardIndex.get(myState?.topCardId);

    const startGame = useCallback(async () => {
        const turnOrderIds = activePlayers.map((p) => p.id);
        if (turnOrderIds.length < 2) return;

        const deck = buildJungleDeck();
        const byPlayer = splitDeckForPlayers(deck, turnOrderIds);
        const playersState = {};
        for (const playerId of turnOrderIds) {
            playersState[playerId] = {
                hiddenDeckCardIds: byPlayer[playerId] || [],
                faceUpPileCardIds: [],
                topCardId: null,
            };
        }

        await set(ref(db, `rooms/${roomId}/gameState`), {
            ...DEFAULT_STATE,
            isGameStarted: true,
            turnPlayerId: turnOrderIds[0],
            turnOrderIds,
            cardDeck: deck,
            playersState,
        }, syncOpts);
        recordGameStarted(roomId, 'jungle-speed');
    }, [activePlayers, roomId, syncOpts]);

    const flipCard = useCallback(async () => {
        if (!gameStarted || stopped || isGameOver || rtdbBusy) return;
        const playersState = roomData.playersState || {};
        const current = playersState[myPlayerId];
        if (!current) return;

        let hidden = [...(current.hiddenDeckCardIds || [])];
        let faceUp = [...(current.faceUpPileCardIds || [])];

        if (hidden.length === 0 && faceUp.length > 0) {
            const recycled = [...faceUp];
            for (let i = recycled.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [recycled[i], recycled[j]] = [recycled[j], recycled[i]];
            }
            hidden = recycled;
            faceUp = [];
        }

        if (hidden.length === 0) return;

        const [drawn, ...rest] = hidden;
        const nextFaceUp = [...faceUp, drawn];
        const nextPlayersState = {
            ...playersState,
            [myPlayerId]: {
                hiddenDeckCardIds: rest,
                faceUpPileCardIds: nextFaceUp,
                topCardId: drawn,
            },
        };

        const nextTurn = nextTurnId(roomData.turnOrderIds, roomData.turnPlayerId) || myPlayerId;
        const winnerId = findWinnerId(nextPlayersState, roomData.turnOrderIds);

        await update(
            ref(db, `rooms/${roomId}/gameState`),
            {
                playersState: nextPlayersState,
                turnPlayerId: winnerId ? roomData.turnPlayerId : nextTurn,
                winnerId: winnerId || null,
                pendingTotem: null,
                isStopped: false,
            },
            syncOpts
        );
    }, [gameStarted, stopped, isGameOver, rtdbBusy, roomData, myPlayerId, roomId, syncOpts]);

    const hitTotem = useCallback(async () => {
        if (!gameStarted || stopped || isGameOver || rtdbBusy) return;
        const pending = evaluateTotemSuggestion(roomData.playersState || {}, myPlayerId, cardIndex);
        await update(
            ref(db, `rooms/${roomId}/gameState`),
            {
                isStopped: true,
                pendingTotem: pending,
            },
            syncOpts
        );
    }, [gameStarted, stopped, isGameOver, rtdbBusy, roomData.playersState, myPlayerId, cardIndex, roomId, syncOpts]);

    const resolveTotem = useCallback(
        async (decisionType, winnerIdOverride = null, penalizedPlayerId = null, receiverPlayerId = null) => {
            if (!isHost || !stopped || !roomData.pendingTotem || isGameOver) return;

            const pending = roomData.pendingTotem;
            const allCards = collectFaceUpCards(roomData.playersState || {});
            let shuffled = [...allCards];
            for (let i = shuffled.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            let recipientId = null;
            let winnerId = null;
            if (decisionType === 'APPROVE_SUGGESTION') {
                winnerId = pending.systemSuggestedWinnerId || null;
                if (winnerId && pending.matchedPlayerIds?.length > 0) {
                    recipientId = receiverPlayerId
                        || pickFirstMatchReceiver(pending.matchedPlayerIds, winnerId, roomData.turnOrderIds);
                } else {
                    recipientId = pending.clickedByPlayerId;
                }
            } else if (decisionType === 'OVERRIDE_WINNER') {
                winnerId = winnerIdOverride || null;
                if (winnerId && pending.matchedPlayerIds?.length > 0) {
                    recipientId = receiverPlayerId
                        || pickFirstMatchReceiver(pending.matchedPlayerIds, winnerId, roomData.turnOrderIds);
                } else {
                    recipientId = pending.clickedByPlayerId;
                }
            } else if (decisionType === 'PENALTY_PLAYER') {
                recipientId = penalizedPlayerId || null;
            }

            let nextPlayersState = createFaceUpClearedPlayersState(roomData.playersState || {});
            if (recipientId && shuffled.length > 0 && nextPlayersState[recipientId]) {
                nextPlayersState = appendCardsToHiddenDeck(nextPlayersState, recipientId, shuffled);
            }

            const winnerAfterResolution = findWinnerId(nextPlayersState, roomData.turnOrderIds);
            await update(
                ref(db, `rooms/${roomId}/gameState`),
                {
                    playersState: nextPlayersState,
                    isStopped: false,
                    pendingTotem: null,
                    winnerId: winnerAfterResolution || null,
                    lastResolution: {
                        decisionType,
                        winnerId: winnerId || null,
                        penalizedPlayerId: penalizedPlayerId || null,
                        cardsMovedCount: shuffled.length,
                        recipientPlayerId: recipientId || null,
                    },
                },
                syncOpts
            );
        },
        [isHost, stopped, roomData, isGameOver, roomId, syncOpts]
    );

    const resetTable = useCallback(async () => {
        await set(ref(db, `rooms/${roomId}/gameState`), null, syncOpts);
    }, [roomId, syncOpts]);

    return (
        <div className="jungle-speed-game">
            {!gameStarted ? (
                <div>
                    <GameRules title={t('games.jungle-speed.name')}>
                        <GameRulesList gameId="jungle-speed" />
                    </GameRules>
                    {isHost ? (
                        <div className="game-host-controls">
                            <button
                                type="button"
                                className="btn-main-action"
                                disabled={activePlayers.length < 2}
                                onClick={() => void startGame()}
                            >
                                {t('gameSetup.jungleSpeed.startButton')}
                            </button>
                            {activePlayers.length < 2 ? (
                                <p className="telepathy-wait-host">{t('gameSetup.jungleSpeed.needPlayers')}</p>
                            ) : null}
                            <HostShareOptions shareOptions={shareOptions} />
                        </div>
                    ) : (
                        <p className="telepathy-wait-host">{t('gameLobby.waitForHostDeck')}</p>
                    )}
                </div>
            ) : (
                <div>
                    <p className="telepathy-round-text">
                        {t('gameUi.jungleTurn', { name: currentPlayerName })}
                    </p>

                    {isGameOver ? (
                        <p className="telepathy-game-over">
                            {t('gameUi.jungleWinner', { name: playerNameById.get(roomData.winnerId) || roomData.winnerId })}
                        </p>
                    ) : null}

                    <div className="jungle-card-zone content-panel content-panel--dark">
                        <p className="jungle-card-zone__label">{t('gameUi.jungleYourCard')}</p>
                        <JungleCardFace card={myTopCard} size="lg" />
                        <p className="jungle-card-zone__meta">
                            {t('gameUi.jungleDeckState', {
                                hidden: myState?.hiddenDeckCardIds?.length || 0,
                                faceUp: myState?.faceUpPileCardIds?.length || 0,
                            })}
                        </p>
                    </div>

                    <div className="jungle-actions">
                        <button
                            type="button"
                            className="btn-main-action"
                            disabled={stopped || isGameOver || rtdbBusy}
                            onClick={() => void flipCard()}
                        >
                            {t('gameUi.jungleFlipCard')}
                        </button>
                        <button
                            type="button"
                            className="btn-emergency bg-dare"
                            disabled={stopped || isGameOver || rtdbBusy}
                            onClick={() => void hitTotem()}
                        >
                            {t('gameUi.jungleTotem')}
                        </button>
                    </div>

                    {stopped && roomData.pendingTotem ? (
                        <div className="jungle-stop-panel content-panel content-panel--dark">
                            <p className="jungle-stop-panel__title">{t('gameUi.jungleStop')}</p>
                            <p>
                                {t('gameUi.jungleTotemBy', {
                                    name: playerNameById.get(roomData.pendingTotem.clickedByPlayerId)
                                        || roomData.pendingTotem.clickedByPlayerId,
                                })}
                            </p>
                            <p>
                                {t('gameUi.jungleSystemSuggestion', {
                                    winner:
                                        (roomData.pendingTotem.systemSuggestedWinnerId
                                            && (playerNameById.get(roomData.pendingTotem.systemSuggestedWinnerId)
                                                || roomData.pendingTotem.systemSuggestedWinnerId))
                                        || t('gameUi.jungleNoMatch'),
                                })}
                            </p>
                            {isHost ? (
                                <div className="jungle-host-panel">
                                    <button
                                        type="button"
                                        className="btn-main-action"
                                        onClick={() => void resolveTotem('APPROVE_SUGGESTION')}
                                    >
                                        {t('gameUi.jungleApprove')}
                                    </button>
                                    <div className="jungle-host-panel__group">
                                        <p>{t('gameUi.jungleOverrideWinner')}</p>
                                        <div className="jungle-host-panel__list">
                                            {roomData.turnOrderIds.map((playerId) => (
                                                <button
                                                    key={`winner-${playerId}`}
                                                    type="button"
                                                    className="btn-impostor-discuss"
                                                    onClick={() => void resolveTotem('OVERRIDE_WINNER', playerId)}
                                                >
                                                    {playerNameById.get(playerId) || playerId}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="jungle-host-panel__group">
                                        <p>{t('gameUi.junglePenaltyPlayer')}</p>
                                        <div className="jungle-host-panel__list">
                                            {roomData.turnOrderIds.map((playerId) => (
                                                <button
                                                    key={`penalty-${playerId}`}
                                                    type="button"
                                                    className="btn-impostor-discuss"
                                                    onClick={() => void resolveTotem('PENALTY_PLAYER', null, playerId)}
                                                >
                                                    {playerNameById.get(playerId) || playerId}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="telepathy-wait-host">{t('gameUi.jungleHostDecides')}</p>
                            )}
                        </div>
                    ) : null}

                    {isHost ? (
                        <div className="game-host-controls">
                            <HostShareOptions shareOptions={shareOptions} />
                            <GameHostResetButton
                                gameId={gameId}
                                canManageRoom={canManageRoom}
                                onLeave={onLeave}
                                onReset={() => void resetTable()}
                                busy={rtdbBusy}
                            />
                        </div>
                    ) : null}
                </div>
            )}

            <GameRoomExitBar
                gameId={gameId}
                canManageRoom={canManageRoom}
                onLeave={onLeave}
                forceResetTable={resetTable}
            />
        </div>
    );
}

export default JungleSpeed;
