export const MAFIA_STATE_VERSION = 2;

export function isLegacyMafiaState(gameState) {
    if (!gameState || gameState.phase === 'lobby') return false;
    if (Number(gameState.stateVersion) >= MAFIA_STATE_VERSION) return false;
    const pd = gameState.playersData;
    if (!pd || typeof pd !== 'object') return false;
    return Object.values(pd).some((p) => p && p.role);
}

export function usesMafiaPrivacyModel(gameState) {
    return Number(gameState?.stateVersion) >= MAFIA_STATE_VERSION;
}

/**
 * @param {string} roomId
 * @param {Record<string, { name: string, role: string, isAlive: boolean }>} playersData
 */
export function buildMafiaPrivacyStartUpdates(roomId, playersData) {
    const updates = {};
    const basePath = `rooms/${roomId}`;
    const publicPlayers = {};
    const hostRoles = {};

    for (const [pid, entry] of Object.entries(playersData)) {
        publicPlayers[pid] = { name: entry.name, isAlive: entry.isAlive !== false };
        hostRoles[pid] = { name: entry.name, role: entry.role, isAlive: true };
        updates[`${basePath}/private/${pid}`] = { role: entry.role };
    }

    updates[`${basePath}/hostOnly`] = { playersData: hostRoles };
    updates[`${basePath}/gameState`] = {
        stateVersion: MAFIA_STATE_VERSION,
        phase: 'playing',
        roleRevealEpoch: 1,
        revealAllRoles: false,
        playersData: publicPlayers,
    };

    return updates;
}
