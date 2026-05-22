/**
 * Fair impostor selection: players who have not been impostor recently get higher weight.
 * Last round's impostor(s) are excluded when fairness is on (no immediate repeat).
 */

export function getImpostorWeights(playerIds, roleHistory, fairnessEnabled) {
    if (!fairnessEnabled) {
        return Object.fromEntries(playerIds.map((id) => [id, 1]));
    }

    const players = roleHistory?.players ?? {};
    const totalRounds = roleHistory?.totalRounds ?? 0;
    const lastImpostorIds = roleHistory?.lastImpostorIds ?? [];

    return Object.fromEntries(
        playerIds.map((id) => {
            if (lastImpostorIds.includes(id)) {
                return [id, 0];
            }
            const lastRound = players[id]?.lastImpostorRound ?? 0;
            const roundsSince = lastRound === 0 ? totalRounds : Math.max(0, totalRounds - lastRound);
            return [id, roundsSince + 1];
        })
    );
}

/** Picks `count` distinct player ids using per-id weights. */
export function pickWeightedWithoutReplacement(playerIds, count, weights) {
    const picked = [];
    let pool = [...playerIds];

    for (let n = 0; n < count && pool.length > 0; n++) {
        const eligible = pool.filter((id) => (weights[id] ?? 1) > 0);
        const candidates = eligible.length > 0 ? eligible : pool;

        const totalWeight = candidates.reduce((sum, id) => sum + (weights[id] ?? 1), 0);
        let r = Math.random() * totalWeight;

        let chosen = candidates[candidates.length - 1];
        for (const id of candidates) {
            r -= weights[id] ?? 1;
            if (r <= 0) {
                chosen = id;
                break;
            }
        }

        picked.push(chosen);
        pool = pool.filter((id) => id !== chosen);
    }

    return picked;
}

export function buildUpdatedRoleHistory(roleHistory, impostorIds, playerIds) {
    const prev = roleHistory ?? { totalRounds: 0, players: {}, lastImpostorIds: [] };
    const totalRounds = (prev.totalRounds ?? 0) + 1;
    const players = { ...prev.players };

    for (const id of playerIds) {
        const entry = players[id] ?? { impostorCount: 0, lastImpostorRound: 0 };
        players[id] = {
            impostorCount: entry.impostorCount + (impostorIds.includes(id) ? 1 : 0),
            lastImpostorRound: impostorIds.includes(id) ? totalRounds : entry.lastImpostorRound
        };
    }

    return {
        totalRounds,
        players,
        lastImpostorIds: impostorIds
    };
}
