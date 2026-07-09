/** Tryby układania graczy w Top Ten. */
export const TOP_TEN_ORDERING_MODES = {
    INDIVIDUAL: 'individual',
    /** Kolejka tur — ▲▼ dowolny ruch, po ruchu następna osoba; opcjonalnie „Pasuje mi”. */
    SHARED_TURN_STEP: 'shared-turn-step',
    /** Kolejka tur — wybierz gracza, przesuń tylko jego ▲▼. */
    SHARED_TURN_PICK_MOVE: 'shared-turn-pick-move',
    /** Kolejka tur — zamiana dowolnych dwóch graczy. */
    SHARED_TURN_SWAP: 'shared-turn-swap',
    /** Kolejka tur — wybierz gracza, podświetl cele, kliknij cel (bez ⇅). */
    SHARED_TURN_PICK_TARGET: 'shared-turn-pick-target',
};

export const TOP_TEN_ORDERING_MODE_LIST = [
    TOP_TEN_ORDERING_MODES.INDIVIDUAL,
    TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP,
    TOP_TEN_ORDERING_MODES.SHARED_TURN_PICK_MOVE,
    TOP_TEN_ORDERING_MODES.SHARED_TURN_SWAP,
    TOP_TEN_ORDERING_MODES.SHARED_TURN_PICK_TARGET,
];

export const DEFAULT_TOP_TEN_ORDERING_MODE = TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP;

const LEGACY_MODE_MAP = {
    'shared-free': TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP,
    'shared-step': TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP,
    'shared-swap-once': TOP_TEN_ORDERING_MODES.SHARED_TURN_SWAP,
    'shared-pair-swap': TOP_TEN_ORDERING_MODES.SHARED_TURN_PICK_TARGET,
};

export function normalizeOrderingMode(mode) {
    const mapped = LEGACY_MODE_MAP[mode] ?? mode;
    return TOP_TEN_ORDERING_MODE_LIST.includes(mapped)
        ? mapped
        : DEFAULT_TOP_TEN_ORDERING_MODE;
}

export function isIndividualOrderingMode(mode) {
    return normalizeOrderingMode(mode) === TOP_TEN_ORDERING_MODES.INDIVIDUAL;
}

export function isSharedOrderingMode(mode) {
    return !isIndividualOrderingMode(mode);
}

export function isTurnBasedOrderingMode(mode) {
    return isSharedOrderingMode(mode);
}

/** @returns {'individual'|'turn-step'|'turn-pick-move'|'turn-swap'|'turn-pick-target'} */
export function getOrderingInteractionKind(mode) {
    const m = normalizeOrderingMode(mode);
    if (m === TOP_TEN_ORDERING_MODES.INDIVIDUAL) return 'individual';
    if (m === TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP) return 'turn-step';
    if (m === TOP_TEN_ORDERING_MODES.SHARED_TURN_PICK_MOVE) return 'turn-pick-move';
    if (m === TOP_TEN_ORDERING_MODES.SHARED_TURN_SWAP) return 'turn-swap';
    return 'turn-pick-target';
}

export function supportsOrderingAgree(mode) {
    return normalizeOrderingMode(mode) === TOP_TEN_ORDERING_MODES.SHARED_TURN_STEP;
}

export function advanceTurnPlayerId(playerIds, currentId) {
    const ids = (playerIds ?? []).filter(Boolean);
    if (ids.length === 0) return null;
    const idx = ids.indexOf(currentId);
    if (idx < 0) return ids[0];
    return ids[(idx + 1) % ids.length];
}

/** Indeks 0 = najwyższa ocena (10). */
export function buildTrueOrderByRatings(ratingsByPlayerId) {
    return Object.entries(ratingsByPlayerId ?? {})
        .filter(([, rating]) => Number.isInteger(rating))
        .sort(([, a], [, b]) => b - a)
        .map(([playerId]) => playerId);
}

/** Niższy wynik = bliżej prawdy. */
export function scoreOrderAgainstRatings(guessOrder, ratingsByPlayerId) {
    const trueOrder = buildTrueOrderByRatings(ratingsByPlayerId);
    if (!Array.isArray(guessOrder) || guessOrder.length === 0 || trueOrder.length === 0) {
        return null;
    }
    let total = 0;
    guessOrder.forEach((playerId, guessedIndex) => {
        const trueIndex = trueOrder.indexOf(playerId);
        if (trueIndex >= 0) total += Math.abs(guessedIndex - trueIndex);
    });
    return total;
}

export function privateOrderToArray(privateOrder) {
    if (Array.isArray(privateOrder)) return privateOrder;
    if (!privateOrder || typeof privateOrder !== 'object') return [];
    return Object.keys(privateOrder)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => privateOrder[k])
        .filter(Boolean);
}
