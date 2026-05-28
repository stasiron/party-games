import { shuffleArray } from '../../lib/shuffle';

export function buildRolesPool(roleCounts) {
    const pool = [];
    for (const [roleId, count] of Object.entries(roleCounts || {})) {
        for (let i = 0; i < (count || 0); i += 1) {
            pool.push(roleId);
        }
    }
    return shuffleArray(pool);
}

export function assignRolesToPlayers(players, shuffledRolesPool) {
    const nextPlayersData = {};
    for (let i = 0; i < players.length; i += 1) {
        const player = players[i];
        nextPlayersData[player.id] = {
            name: player.name,
            role: shuffledRolesPool[i],
            isAlive: true,
        };
    }
    return nextPlayersData;
}

export function sumAssignedRoles(roleCounts) {
    return Object.values(roleCounts || {}).reduce((sum, count) => sum + (count || 0), 0);
}
