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

/** Wymuszone losowanie zamrożonej karty SHOW (bez filtrów / random). */
export function chooseCardFromIndicesAt({ remainingIndices, basePool, atIdx }) {
    if (atIdx == null || !Array.isArray(remainingIndices) || !remainingIndices.includes(atIdx)) {
        return null;
    }
    const card = basePool?.[atIdx];
    if (!card) return null;
    return {
        selectedItem: card,
        nextIndices: remainingIndices.filter((i) => i !== atIdx),
    };
}

/** Legacy: wymuszone pobranie karty z pozycji w puli. */
export function chooseCardAtPoolIndex({ currentPool, atIndex }) {
    if (atIndex == null || !Array.isArray(currentPool) || atIndex < 0 || atIndex >= currentPool.length) {
        return null;
    }
    const card = currentPool[atIndex];
    if (!card) return null;
    return {
        selectedItem: card,
        nextPool: [
            ...currentPool.slice(0, atIndex),
            ...currentPool.slice(atIndex + 1),
        ],
    };
}

/**
 * Pewny podgląd SHOW — nagłówek kolejki pul (karta po bieżącej, nie wyświetlana).
 */
export function resolveShowLockedTodPreview(state, contentByCategory) {
    if (!state?.isGameStarted || state.showNextPreview !== true) {
        return { truth: null, dare: null };
    }

    const pools = resolveTodPoolState(state, contentByCategory);

    if (pools.legacy) {
        return {
            truth: pools.truthPool[0] ?? null,
            dare: pools.darePool[0] ?? null,
        };
    }

    const truthIdx = pools.truthIndices[0];
    const dareIdx = pools.dareIndices[0];
    return {
        truth: truthIdx != null ? pools.baseTruths[truthIdx] ?? null : null,
        dare: dareIdx != null ? pools.baseDares[dareIdx] ?? null : null,
    };
}

/**
 * Pozycje następnych kart ToD — nagłówek kolejki (PUPPET odrzuca te karty).
 */
export function getShowLockedTodPickEntries(state, contentByCategory) {
    if (!state?.isGameStarted) {
        return { legacy: false, truthPick: null, darePick: null };
    }

    const pools = resolveTodPoolState(state, contentByCategory);

    if (pools.legacy) {
        return {
            legacy: true,
            truthPick: pools.truthPool.length > 0 ? { index: 0, card: pools.truthPool[0] } : null,
            darePick: pools.darePool.length > 0 ? { index: 0, card: pools.darePool[0] } : null,
        };
    }

    const truthIdx = pools.truthIndices[0];
    const dareIdx = pools.dareIndices[0];

    return {
        legacy: false,
        truthPick:
            truthIdx != null
                ? { idx: truthIdx, card: pools.baseTruths[truthIdx] }
                : null,
        darePick:
            dareIdx != null
                ? { idx: dareIdx, card: pools.baseDares[dareIdx] }
                : null,
    };
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

function peekFirstPickFromEntries(entries, safeMode, playerStats, currentPlayerName) {
    const candidateEntries = filterCandidateEntries(
        entries,
        safeMode,
        playerStats,
        currentPlayerName
    );
    if (!candidateEntries?.length) return null;
    const sorted = [...candidateEntries].sort((a, b) => {
        const ai = a.index ?? a.idx ?? 0;
        const bi = b.index ?? b.idx ?? 0;
        return ai - bi;
    });
    return sorted[0];
}

function peekFirstCardFromEntries(entries, safeMode, playerStats, currentPlayerName) {
    return peekFirstPickFromEntries(entries, safeMode, playerStats, currentPlayerName)?.card ?? null;
}

/**
 * Indeksy/pozycje kart z podglądu SHOW — do odrzucenia przez PUPPET.
 */
export function peekTodNextPickEntries(state, contentByCategory, { safeMode = false } = {}) {
    if (!state?.isGameStarted) {
        return { legacy: false, truthPick: null, darePick: null };
    }

    const pools = resolveTodPoolState(state, contentByCategory);
    const playerStats = state.playerStats || {};
    const currentPlayerName = state.currentPlayerName || '';

    if (pools.legacy) {
        return {
            legacy: true,
            truthPick: peekFirstPickFromEntries(
                pools.truthPool.map((card, index) => ({ index, card })),
                safeMode,
                playerStats,
                currentPlayerName
            ),
            darePick: peekFirstPickFromEntries(
                pools.darePool.map((card, index) => ({ index, card })),
                safeMode,
                playerStats,
                currentPlayerName
            ),
        };
    }

    const truthEntries = pools.truthIndices
        .map((idx) => ({ idx, card: pools.baseTruths[idx] }))
        .filter(({ card }) => card != null);
    const dareEntries = pools.dareIndices
        .map((idx) => ({ idx, card: pools.baseDares[idx] }))
        .filter(({ card }) => card != null);

    return {
        legacy: false,
        truthPick: peekFirstPickFromEntries(truthEntries, safeMode, playerStats, currentPlayerName),
        darePick: peekFirstPickFromEntries(dareEntries, safeMode, playerStats, currentPlayerName),
    };
}

/**
 * Podgląd następnej karty — pewny gdy SHOW zamroził indeksy w gameState.
 */
export function peekTodNextCards(state, contentByCategory) {
    if (state?.showNextPreview === true) {
        return resolveShowLockedTodPreview(state, contentByCategory);
    }
    return { truth: null, dare: null };
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
