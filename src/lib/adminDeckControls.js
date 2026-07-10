import { TOD_POOL_VERSION } from '../games/truth-or-dare/engine';
import {
    gameUsesAdminDeckControls,
    gameUsesPuppetTurn,
    gameUsesPuppetSkipOnly,
} from './room/gameRoomContract';
export const SHOW_PREVIEW_STATE_KEY = 'showNextPreview';
export const SHOW_PREVIEW_DECK_ANCHOR_KEY = 'showPreviewDeckAnchor';
export const SHOW_PREVIEW_NEXT_INDEX_KEY = 'showPreviewNextIndex';
export const SHOW_LOCKED_TRUTH_IDX_KEY = 'showLockedTruthIdx';
export const SHOW_LOCKED_DARE_IDX_KEY = 'showLockedDareIdx';
export const SHOW_LOCKED_TRUTH_POS_KEY = 'showLockedTruthPos';
export const SHOW_LOCKED_DARE_POS_KEY = 'showLockedDarePos';
export const PUPPET_MODE_STATE_KEY = 'puppetMode';
export const PUPPET_OPERATOR_STATE_KEY = 'puppetOperatorPlayerId';
export const PUPPET_NEXT_PLAYER_KEY = 'puppetNextPlayerName';
export const SHOW_OPERATOR_STATE_KEY = 'showOperatorPlayerId';

/** Klucze w gameState — bez treści kart w RTDB. */

export function isAdminDeckControlGame(gameId) {
    return gameUsesAdminDeckControls(gameId);
}

export function isPuppetTurnGame(gameId) {
    return gameUsesPuppetTurn(gameId);
}

export function isPuppetSkipOnlyGame(gameId) {
    return gameUsesPuppetSkipOnly(gameId);
}

export function isShowPreviewActive(state) {
    return state?.[SHOW_PREVIEW_STATE_KEY] === true;
}

export function isPuppetModeActive(state) {
    return state?.[PUPPET_MODE_STATE_KEY] === true;
}

export function isAdminDeckPanelVisible(state) {
    return isShowPreviewActive(state) || isPuppetModeActive(state);
}

function isOperatorMatch(state, operatorKey, myPlayerId) {
    const operatorId = state?.[operatorKey];
    if (!operatorId || !myPlayerId) return false;
    return operatorId === myPlayerId;
}

/** Podgląd SHOW — tylko operator komendy. */
export function isShowPreviewVisibleToPlayer(state, myPlayerId) {
    return isShowPreviewActive(state) && isOperatorMatch(state, SHOW_OPERATOR_STATE_KEY, myPlayerId);
}

/** Panel PUPPET — tylko operator komendy. */
export function isPuppetPanelVisibleToPlayer(state, myPlayerId) {
    return isPuppetModeActive(state) && isOperatorMatch(state, PUPPET_OPERATOR_STATE_KEY, myPlayerId);
}

/** Cały panel admina — widoczny tylko gdy co najmniej jedna sekcja dotyczy tego gracza. */
export function isAdminDeckPanelVisibleToPlayer(state, myPlayerId) {
    return isShowPreviewVisibleToPlayer(state, myPlayerId)
        || isPuppetPanelVisibleToPlayer(state, myPlayerId);
}

/** Sterowanie PUPPET — tylko operator komendy (musi być w pokoju jako gracz). */
export function canUsePuppetControls(state, myPlayerId) {
    return isPuppetPanelVisibleToPlayer(state, myPlayerId);
}

export function adminDeckControlFingerprintSuffix(data) {
    let suffix = '';
    if (data?.[SHOW_PREVIEW_STATE_KEY] === true) {
        suffix += `:show:${data[SHOW_OPERATOR_STATE_KEY] || ''}:${data[SHOW_PREVIEW_DECK_ANCHOR_KEY] ?? ''}:${data[SHOW_PREVIEW_NEXT_INDEX_KEY] ?? ''}`;
        suffix += `:${data[SHOW_LOCKED_TRUTH_IDX_KEY] ?? ''}:${data[SHOW_LOCKED_DARE_IDX_KEY] ?? ''}`;
    }
    if (data?.[PUPPET_MODE_STATE_KEY] === true) {
        suffix += `:pup:${data[PUPPET_OPERATOR_STATE_KEY] || ''}:${data[PUPPET_NEXT_PLAYER_KEY] || ''}`;
    }
    return suffix;
}

function deckIndexKeyForGame(gameId) {
    return gameId === 'who-would-rather' ? 'currentDilemmaIndex' : 'currentQuestionIndex';
}

/**
 * SHOW zamraża następne karty ToD (indeksy w puli) — podgląd = draw.
 * @param {string|null|undefined} [operatorPlayerId] — ustaw tylko przy pierwszym SHOW (nie przy odświeżaniu locków).
 * @returns {Record<string, unknown>}
 */
export function buildShowCommandUpdates(roomId, gameId, gameState, operatorPlayerId) {
    const updates = {
        [`rooms/${roomId}/gameState/${SHOW_PREVIEW_STATE_KEY}`]: true,
    };
    if (operatorPlayerId !== undefined) {
        updates[`rooms/${roomId}/gameState/${SHOW_OPERATOR_STATE_KEY}`] = operatorPlayerId || null;
    }

    if (gameId !== 'truth-or-dare') {
        const indexKey = deckIndexKeyForGame(gameId);
        const anchor = Number(gameState?.[indexKey] ?? 0);
        updates[`rooms/${roomId}/gameState/${SHOW_PREVIEW_DECK_ANCHOR_KEY}`] = anchor;
        updates[`rooms/${roomId}/gameState/${SHOW_PREVIEW_NEXT_INDEX_KEY}`] = anchor + 1;
        return updates;
    }
    if (gameState?.poolVersion === TOD_POOL_VERSION) {
        const truthQueue = gameState.remainingTruthIndices;
        const dareQueue = gameState.remainingDareIndices;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_TRUTH_IDX_KEY}`] =
            Array.isArray(truthQueue) && truthQueue.length > 0 ? truthQueue[0] : null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_DARE_IDX_KEY}`] =
            Array.isArray(dareQueue) && dareQueue.length > 0 ? dareQueue[0] : null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_TRUTH_POS_KEY}`] = null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_DARE_POS_KEY}`] = null;
    } else {
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_TRUTH_IDX_KEY}`] = null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_DARE_IDX_KEY}`] = null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_TRUTH_POS_KEY}`] =
            Array.isArray(gameState?.truthPool) && gameState.truthPool.length > 0 ? 0 : null;
        updates[`rooms/${roomId}/gameState/${SHOW_LOCKED_DARE_POS_KEY}`] =
            Array.isArray(gameState?.darePool) && gameState.darePool.length > 0 ? 0 : null;
    }

    return updates;
}

/** Indeks następnej karty talii — uwzględnia kotwicę SHOW i przesunięcie po „Następne”. */
export function resolveShowNextDeckIndex(state, indexKey = 'currentQuestionIndex') {
    const liveIndex = Number(state?.[indexKey] ?? 0);
    if (state?.showNextPreview !== true) {
        return liveIndex + 1;
    }
    const frozenNext = state?.showPreviewNextIndex;
    if (frozenNext == null) {
        return liveIndex + 1;
    }
    const anchor = Number(state?.showPreviewDeckAnchor ?? -1);
    return anchor === liveIndex ? Number(frozenNext) : liveIndex + 1;
}

export function buildRefreshTodShowLockUpdates(roomId, gameState) {
    return buildShowCommandUpdates(roomId, 'truth-or-dare', gameState);
}
