import cardsV1 from '../../data/games/jungle-speed/cards.v1.json';

function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function buildJungleDeck() {
    return shuffle(
        (cardsV1 || []).map((card) => ({
            id: card.id,
            shape: card.shape,
            color: card.color,
        }))
    );
}

export function buildCardIndex(deck) {
    return new Map((deck || []).map((card) => [card.id, card]));
}

export function splitDeckForPlayers(deck, playerIds) {
    const result = {};
    for (const playerId of playerIds) {
        result[playerId] = [];
    }
    for (let i = 0; i < deck.length; i += 1) {
        const playerId = playerIds[i % playerIds.length];
        result[playerId].push(deck[i].id);
    }
    return result;
}

export function evaluateTotemSuggestion(playersState, clickedByPlayerId, cardIndex) {
    const clickedTopCardId = playersState?.[clickedByPlayerId]?.topCardId || null;
    if (!clickedTopCardId) {
        return {
            clickedByPlayerId,
            systemSuggestedWinnerId: null,
            matchedPlayerIds: [],
            requiresHostDecision: true,
        };
    }

    const clickedShape = cardIndex.get(clickedTopCardId)?.shape;
    if (!clickedShape) {
        return {
            clickedByPlayerId,
            systemSuggestedWinnerId: null,
            matchedPlayerIds: [],
            requiresHostDecision: true,
        };
    }

    const matchedPlayerIds = Object.entries(playersState || {})
        .filter(([playerId, state]) => {
            if (playerId === clickedByPlayerId) return false;
            const shape = cardIndex.get(state?.topCardId)?.shape;
            return !!shape && shape === clickedShape;
        })
        .map(([playerId]) => playerId);

    return {
        clickedByPlayerId,
        systemSuggestedWinnerId: matchedPlayerIds.length > 0 ? clickedByPlayerId : null,
        matchedPlayerIds,
        requiresHostDecision: true,
    };
}

export function collectFaceUpCards(playersState) {
    return Object.values(playersState || {}).flatMap((state) => state?.faceUpPileCardIds || []);
}

export function createFaceUpClearedPlayersState(playersState) {
    const next = {};
    for (const [playerId, state] of Object.entries(playersState || {})) {
        next[playerId] = {
            hiddenDeckCardIds: [...(state?.hiddenDeckCardIds || [])],
            faceUpPileCardIds: [],
            topCardId: null,
        };
    }
    return next;
}

export function appendCardsToHiddenDeck(playersState, playerId, cardIds) {
    const next = {
        ...playersState,
        [playerId]: {
            ...playersState[playerId],
            hiddenDeckCardIds: [...(playersState[playerId]?.hiddenDeckCardIds || []), ...cardIds],
        },
    };
    return next;
}

export function pickFirstMatchReceiver(matchedPlayerIds, winnerId, turnOrderIds) {
    const candidates = (matchedPlayerIds || []).filter((id) => id !== winnerId);
    if (candidates.length === 0) return null;
    const order = turnOrderIds || [];
    return order.find((id) => candidates.includes(id)) || candidates[0];
}

export function findWinnerId(playersState, turnOrderIds) {
    const order = turnOrderIds || Object.keys(playersState || {});
    for (const playerId of order) {
        const state = playersState?.[playerId];
        if (!state) continue;
        if ((state.hiddenDeckCardIds?.length || 0) === 0 && (state.faceUpPileCardIds?.length || 0) === 0) {
            return playerId;
        }
    }
    return null;
}

export function nextTurnId(turnOrderIds, currentTurnPlayerId) {
    const order = turnOrderIds || [];
    if (order.length === 0) return null;
    const currentIndex = order.indexOf(currentTurnPlayerId);
    if (currentIndex < 0) return order[0];
    return order[(currentIndex + 1) % order.length];
}
