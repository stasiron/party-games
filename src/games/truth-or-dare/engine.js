import { getActivePlayerNames, pickRandomPlayerName } from '../../lib/playerNames';
import { shuffleArray } from '../../lib/shuffle';

export { pickRandomPlayerName };

export const TOD_POOL_VERSION = 1;

const EMPTY_STATS = { totalLevel: 0, count: 0 };

export function buildInitialStats(tablePlayers) {
    const stats = {};
    for (const name of getActivePlayerNames(tablePlayers)) {
        stats[name] = { ...EMPTY_STATS };
    }
    return stats;
}

export function buildPools(contentByCategory, selectedCategories) {
    const truths = [];
    const dares = [];
    for (const categoryId of selectedCategories) {
        const pack = contentByCategory[categoryId];
        if (!pack) continue;
        if (Array.isArray(pack.truth)) truths.push(...pack.truth);
        if (Array.isArray(pack.dare)) dares.push(...pack.dare);
    }
    return { truths, dares };
}

/** Tasuje indeksy pul przy starcie gry (treść kart zostaje w bundlu). */
export function buildInitialPoolIndices(truths, dares) {
    return {
        remainingTruthIndices: shuffleArray(truths.map((_, i) => i)),
        remainingDareIndices: shuffleArray(dares.map((_, i) => i)),
    };
}

export function computeRoomAverage(playerStats) {
    let roomTotalLevel = 0;
    let roomTotalCount = 0;
    for (const stats of Object.values(playerStats || {})) {
        roomTotalLevel += stats?.totalLevel || 0;
        roomTotalCount += stats?.count || 0;
    }
    return roomTotalCount > 0 ? roomTotalLevel / roomTotalCount : 0;
}

function filterCandidateEntries(entries, safeMode, playerStats, currentPlayerName) {
    if (safeMode) {
        const safe = entries.filter(({ card }) => card.level <= 3);
        return safe.length > 0 ? safe : null;
    }

    const roomAvg = computeRoomAverage(playerStats);
    const myStats = playerStats?.[currentPlayerName] || EMPTY_STATS;
    const myAvg = myStats.count > 0 ? myStats.totalLevel / myStats.count : 0;
    if (myAvg < roomAvg) {
        const harder = entries.filter(({ card }) => card.level >= Math.floor(roomAvg));
        if (harder.length > 0) return harder;
    }
    return entries;
}

/** Legacy: pełne obiekty kart w RTDB. */
export function chooseCard({
    currentPool,
    safeMode,
    playerStats,
    currentPlayerName,
}) {
    if (!Array.isArray(currentPool) || currentPool.length === 0) return null;

    const entries = currentPool.map((card, index) => ({ index, card }));
    const candidateEntries = filterCandidateEntries(
        entries,
        safeMode,
        playerStats,
        currentPlayerName
    );
    if (!candidateEntries?.length) return null;

    const pick = candidateEntries[Math.floor(Math.random() * candidateEntries.length)];
    const nextPool = [
        ...currentPool.slice(0, pick.index),
        ...currentPool.slice(pick.index + 1),
    ];

    return { selectedItem: pick.card, nextPool };
}

/**
 * v1: losowanie z puli indeksów (Math.random na kandydatach po filtrach).
 * @param {number[]} remainingIndices
 * @param {{ text: string, level: number }[]} basePool
 */
export function chooseCardFromIndices({
    remainingIndices,
    basePool,
    safeMode,
    playerStats,
    currentPlayerName,
}) {
    if (!Array.isArray(remainingIndices) || remainingIndices.length === 0) return null;
    if (!Array.isArray(basePool) || basePool.length === 0) return null;

    const entries = remainingIndices
        .map((idx) => ({ idx, card: basePool[idx] }))
        .filter(({ card }) => card != null);

    if (!entries.length) return null;

    const candidateEntries = filterCandidateEntries(
        entries,
        safeMode,
        playerStats,
        currentPlayerName
    );
    if (!candidateEntries?.length) return null;

    const pick = candidateEntries[Math.floor(Math.random() * candidateEntries.length)];
    const nextIndices = remainingIndices.filter((i) => i !== pick.idx);

    return { selectedItem: pick.card, nextIndices };
}

/**
 * Odtwarza pule z gameState — v1 (indeksy) lub legacy (pełne tablice).
 * @param {object|null|undefined} state
 * @param {Record<string, { truth?: object[], dare?: object[] }>} contentByCategory
 */
export function resolveTodPoolState(state, contentByCategory) {
    if (
        state?.poolVersion === TOD_POOL_VERSION &&
        Array.isArray(state.categoryIds) &&
        state.categoryIds.length > 0
    ) {
        const { truths, dares } = buildPools(contentByCategory, state.categoryIds);
        return {
            legacy: false,
            baseTruths: truths,
            baseDares: dares,
            truthIndices: Array.isArray(state.remainingTruthIndices)
                ? state.remainingTruthIndices
                : [],
            dareIndices: Array.isArray(state.remainingDareIndices)
                ? state.remainingDareIndices
                : [],
        };
    }

    return {
        legacy: true,
        truthPool: Array.isArray(state?.truthPool) ? state.truthPool : [],
        darePool: Array.isArray(state?.darePool) ? state.darePool : [],
    };
}

export function getTodPoolLengths(state) {
    if (!state) return { truthLen: 0, dareLen: 0 };
    if (state.poolVersion === TOD_POOL_VERSION) {
        return {
            truthLen: state.remainingTruthIndices?.length ?? 0,
            dareLen: state.remainingDareIndices?.length ?? 0,
        };
    }
    return {
        truthLen: state.truthPool?.length ?? 0,
        dareLen: state.darePool?.length ?? 0,
    };
}

export function buildUpdatedPlayerStats(playerStats, currentPlayerName, selectedItemLevel) {
    const stats = playerStats || {};
    const prev = stats[currentPlayerName] || EMPTY_STATS;
    return {
        ...stats,
        [currentPlayerName]: {
            totalLevel: prev.totalLevel + selectedItemLevel,
            count: prev.count + 1,
        },
    };
}
