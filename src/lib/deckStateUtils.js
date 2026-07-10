import { resolveShowNextDeckIndex } from './adminDeckControls';

export const DECK_VERSION = 1;

/**
 * Odtwarza talię z gameState: nowy format (categoryIds + order) lub legacy (pełna tablica).
 * @param {object|null|undefined} state
 * @param {(categoryIds: string[]) => unknown[]} buildDeckFromCategoryIds
 * @param {{ legacyDeckKey?: string }} [options]
 */
export function resolveDeckFromState(state, buildDeckFromCategoryIds, { legacyDeckKey = 'shuffledQuestions' } = {}) {
    if (!state?.isGameStarted) return [];
    const legacyDeck = state[legacyDeckKey];
    if (Array.isArray(legacyDeck) && legacyDeck.length > 0) {
        return legacyDeck;
    }
    if (
        state.deckVersion === DECK_VERSION &&
        Array.isArray(state.categoryIds) &&
        Array.isArray(state.order) &&
        typeof buildDeckFromCategoryIds === 'function'
    ) {
        const baseDeck = buildDeckFromCategoryIds(state.categoryIds);
        if (!baseDeck.length) return [];
        return state.order
            .map((idx) => baseDeck[idx])
            .filter((item) => item != null);
    }
    return [];
}

/**
 * Następna karta talii (indeks + 1) — bez zapisu w RTDB.
 * @param {object|null|undefined} state
 * @param {(categoryIds: string[]) => unknown[]} buildDeckFromCategoryIds
 * @param {{ indexKey?: string, legacyDeckKey?: string }} [options]
 */
export function resolveNextDeckItemFromState(state, buildDeckFromCategoryIds, {
    indexKey = 'currentQuestionIndex',
    legacyDeckKey = 'shuffledQuestions',
} = {}) {
    const deck = resolveDeckFromState(state, buildDeckFromCategoryIds, { legacyDeckKey });
    if (!deck.length) return null;
    const nextIndex = resolveShowNextDeckIndex(state, indexKey);
    if (nextIndex >= deck.length || nextIndex < 0) return null;
    return deck[nextIndex];
}

function adminDeckControlFingerprintSuffix(data) {
    let suffix = '';
    if (data?.showNextPreview === true) {
        suffix += `:show:${data.showOperatorPlayerId || ''}:${data.showPreviewDeckAnchor ?? ''}:${data.showPreviewNextIndex ?? ''}`;
    }
    if (data?.puppetMode === true) {
        suffix += `:pup:${data.puppetOperatorPlayerId || ''}:${data.puppetNextPlayerName || ''}`;
    }
    return suffix;
}

/**
 * Lekki fingerprint stanu talii — pomija pełną tablicę kart w RTDB.
 * @param {object|null|undefined} data
 * @param {{ indexKey?: string, legacyDeckKey?: string, extra?: (data: object) => string }} [options]
 */
export function deckStateFingerprint(data, {
    indexKey = 'currentQuestionIndex',
    legacyDeckKey = 'shuffledQuestions',
    extra = () => '',
} = {}) {
    if (!data || !data.isGameStarted) return 'idle';
    const legacyDeck = data[legacyDeckKey];
    const showSuffix = adminDeckControlFingerprintSuffix(data);
    if (Array.isArray(legacyDeck) && legacyDeck.length > 0) {
        return `legacy:${data[indexKey] ?? 0}:${legacyDeck.length}:${extra(data)}${showSuffix}`;
    }
    const orderLen = Array.isArray(data.order) ? data.order.length : 0;
    const cats = Array.isArray(data.categoryIds) ? data.categoryIds.join(',') : '';
    return `v${data.deckVersion || 0}:${data[indexKey] ?? 0}:${orderLen}:${cats}:${extra(data)}${showSuffix}`;
}
