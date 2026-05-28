const EMPTY_STATS = { totalLevel: 0, count: 0 };

function getActivePlayerNames(tablePlayers) {
    if (!Array.isArray(tablePlayers)) return [];
    const names = [];
    for (const player of tablePlayers) {
        if (!player || player.isKicked) continue;
        const normalizedName = String(player.name || '').trim();
        if (!normalizedName) continue;
        names.push(normalizedName);
    }
    return names;
}

export function pickRandomPlayerName(tablePlayers, excludeName = null) {
    const allNames = getActivePlayerNames(tablePlayers);
    if (allNames.length === 0) return 'Gracz';
    if (excludeName && allNames.length > 1) {
        const filtered = allNames.filter((name) => name !== excludeName);
        if (filtered.length > 0) {
            return filtered[Math.floor(Math.random() * filtered.length)];
        }
    }
    return allNames[Math.floor(Math.random() * allNames.length)];
}

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

export function computeRoomAverage(playerStats) {
    let roomTotalLevel = 0;
    let roomTotalCount = 0;
    for (const stats of Object.values(playerStats || {})) {
        roomTotalLevel += stats?.totalLevel || 0;
        roomTotalCount += stats?.count || 0;
    }
    return roomTotalCount > 0 ? roomTotalLevel / roomTotalCount : 0;
}

export function chooseCard({
    currentPool,
    safeMode,
    playerStats,
    currentPlayerName,
}) {
    if (!Array.isArray(currentPool) || currentPool.length === 0) return null;

    let candidatePool = currentPool;
    if (safeMode) {
        const safePool = currentPool.filter((item) => item.level <= 3);
        if (safePool.length === 0) return null;
        candidatePool = safePool;
    } else {
        const roomAvg = computeRoomAverage(playerStats);
        const myStats = playerStats?.[currentPlayerName] || EMPTY_STATS;
        const myAvg = myStats.count > 0 ? myStats.totalLevel / myStats.count : 0;
        if (myAvg < roomAvg) {
            const harder = currentPool.filter((item) => item.level >= Math.floor(roomAvg));
            if (harder.length > 0) candidatePool = harder;
        }
    }

    const selectedItem = candidatePool[Math.floor(Math.random() * candidatePool.length)];
    const itemIndex = currentPool.findIndex((item) => item.text === selectedItem.text);
    const nextPool = itemIndex === -1
        ? currentPool
        : [...currentPool.slice(0, itemIndex), ...currentPool.slice(itemIndex + 1)];

    return { selectedItem, nextPool };
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
