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
    if (Array.isArray(legacyDeck) && legacyDeck.length > 0) {
        return `legacy:${data[indexKey] ?? 0}:${legacyDeck.length}:${extra(data)}`;
    }
    const orderLen = Array.isArray(data.order) ? data.order.length : 0;
    const cats = Array.isArray(data.categoryIds) ? data.categoryIds.join(',') : '';
    return `v${data.deckVersion || 0}:${data[indexKey] ?? 0}:${orderLen}:${cats}:${extra(data)}`;
}
