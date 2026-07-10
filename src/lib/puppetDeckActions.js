import { getShowLockedTodPickEntries } from '../games/truth-or-dare/engine';
import {
    buildRefreshTodShowLockUpdates,
    resolveShowNextDeckIndex,
    PUPPET_NEXT_PLAYER_KEY,
} from './adminDeckControls';

/**
 * Usuwa następną kartę z talii (pozycja currentIndex + 1) — jeden update order/legacy deck.
 * @returns {Record<string, unknown>|null}
 */
export function buildSkipNextDeckQuestionUpdates(state, roomId, {
    indexKey = 'currentQuestionIndex',
    legacyDeckKey = 'shuffledQuestions',
} = {}) {
    if (!state?.isGameStarted) return null;

    const nextPos = resolveShowNextDeckIndex(state, indexKey);

    const legacyDeck = state[legacyDeckKey];
    if (Array.isArray(legacyDeck) && legacyDeck.length > 0) {
        if (nextPos >= legacyDeck.length) return null;
        const newDeck = [
            ...legacyDeck.slice(0, nextPos),
            ...legacyDeck.slice(nextPos + 1),
        ];
        return { [`rooms/${roomId}/gameState/${legacyDeckKey}`]: newDeck };
    }

    const order = state.order;
    if (!Array.isArray(order) || nextPos >= order.length) return null;

    const newOrder = [
        ...order.slice(0, nextPos),
        ...order.slice(nextPos + 1),
    ];
    return { [`rooms/${roomId}/gameState/order`]: newOrder };
}

/**
 * Usuwa zamrożone karty SHOW z pul ToD i odświeża locki.
 * @returns {Record<string, unknown>|null}
 */
export function buildSkipTodNextPreviewUpdates(state, roomId, contentByCategory) {
    if (!state?.isGameStarted) return null;

    const picks = getShowLockedTodPickEntries(state, contentByCategory);
    const updates = {};

    if (picks.legacy) {
        if (picks.truthPick != null) {
            const pool = Array.isArray(state.truthPool) ? state.truthPool : [];
            if (pool.length > 0) {
                updates[`rooms/${roomId}/gameState/truthPool`] = pool.slice(1);
            }
        }
        if (picks.darePick != null) {
            const pool = Array.isArray(state.darePool) ? state.darePool : [];
            if (pool.length > 0) {
                updates[`rooms/${roomId}/gameState/darePool`] = pool.slice(1);
            }
        }
    } else {
        if (picks.truthPick?.idx != null) {
            const remaining = Array.isArray(state.remainingTruthIndices)
                ? state.remainingTruthIndices
                : [];
            updates[`rooms/${roomId}/gameState/remainingTruthIndices`] = remaining.filter(
                (i) => i !== picks.truthPick.idx
            );
        }
        if (picks.darePick?.idx != null) {
            const remaining = Array.isArray(state.remainingDareIndices)
                ? state.remainingDareIndices
                : [];
            updates[`rooms/${roomId}/gameState/remainingDareIndices`] = remaining.filter(
                (i) => i !== picks.darePick.idx
            );
        }
    }

    if (Object.keys(updates).length === 0) return null;

    const nextState = { ...state };
    for (const [path, value] of Object.entries(updates)) {
        const key = path.split('/').pop();
        nextState[key] = value;
    }

    return {
        ...updates,
        ...buildRefreshTodShowLockUpdates(roomId, nextState),
    };
}

export function buildAssignNextTurnUpdates(roomId, playerName) {
    const name = String(playerName || '').trim();
    if (!name) return null;
    return { [`rooms/${roomId}/gameState/${PUPPET_NEXT_PLAYER_KEY}`]: name };
}

/** @deprecated użyj buildAssignNextTurnUpdates */
export function buildAssignTurnUpdates(roomId, playerName) {
    return buildAssignNextTurnUpdates(roomId, playerName);
}
