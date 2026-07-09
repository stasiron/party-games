/** @typedef {{ isImpostor: boolean, word: string | null }} ImpostorPrivateEntry */
/** @typedef {{ impostorIds: string[], word: string, chosenCatId?: string }} ImpostorHostOnly */

export const IMPOSTOR_STATE_VERSION = 2;

export function isLegacyImpostorState(gameState) {
    if (!gameState || gameState.phase === 'lobby') return false;
    if (Number(gameState.stateVersion) >= IMPOSTOR_STATE_VERSION) return false;
    return (
        Boolean(gameState.impostorId)
        || (Array.isArray(gameState.impostorIds) && gameState.impostorIds.length > 0)
        || Boolean(gameState.word)
    );
}

export function usesImpostorPrivacyModel(gameState) {
    return Number(gameState?.stateVersion) >= IMPOSTOR_STATE_VERSION;
}

/**
 * Buduje mapę update'ów RTDB dla nowej rundy Impostor (model v2).
 */
export function buildImpostorPrivacyUpdates(roomId, playerIds, round, publicFields) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    updates[`${basePath}/gameState`] = {
        stateVersion: IMPOSTOR_STATE_VERSION,
        phase: 'peeking',
        categoryName: publicFields.categoryName,
        startingPlayerId: round.startingPlayerId,
        categoryIds: publicFields.categoryIds,
        roleRevealEpoch: publicFields.roleRevealEpoch,
        totalImpostors: round.chosenImpostorIds.length,
        eliminatedImpostors: 0,
        roundResult: '',
        revealAllRoles: false,
    };

    updates[`${basePath}/hostOnly`] = {
        impostorIds: round.chosenImpostorIds,
        word: round.randomWord,
        chosenCatId: round.chosenCatId,
    };

    for (const pid of playerIds) {
        const isImpostor = round.chosenImpostorIds.includes(pid);
        updates[`${basePath}/private/${pid}`] = {
            isImpostor,
            word: isImpostor ? null : round.randomWord,
        };
    }

    return updates;
}

export function buildImpostorPrivacyPatchUpdates(roomId, playerIds, round, publicFields) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    Object.assign(updates, {
        [`${basePath}/gameState/categoryName`]: publicFields.categoryName,
        [`${basePath}/gameState/startingPlayerId`]: round.startingPlayerId,
        [`${basePath}/gameState/phase`]: 'peeking',
        [`${basePath}/gameState/roleRevealEpoch`]: publicFields.roleRevealEpoch,
        [`${basePath}/gameState/totalImpostors`]: round.chosenImpostorIds.length,
        [`${basePath}/gameState/eliminatedImpostors`]: 0,
        [`${basePath}/gameState/roundResult`]: '',
        [`${basePath}/gameState/revealAllRoles`]: false,
        [`${basePath}/gameState/stateVersion`]: IMPOSTOR_STATE_VERSION,
    });

    updates[`${basePath}/hostOnly`] = {
        impostorIds: round.chosenImpostorIds,
        word: round.randomWord,
        chosenCatId: round.chosenCatId,
    };

    for (const pid of playerIds) {
        const isImpostor = round.chosenImpostorIds.includes(pid);
        updates[`${basePath}/private/${pid}`] = {
            isImpostor,
            word: isImpostor ? null : round.randomWord,
        };
    }

    return updates;
}

/** Start rundy bez modelu prywatności (gdy reguły RTDB nie mają jeszcze private/hostOnly). */
export function buildImpostorLegacyStartUpdates(roomId, round, publicFields) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            phase: 'peeking',
            categoryName: publicFields.categoryName,
            startingPlayerId: round.startingPlayerId,
            categoryIds: publicFields.categoryIds,
            roleRevealEpoch: publicFields.roleRevealEpoch,
            totalImpostors: round.chosenImpostorIds.length,
            eliminatedImpostors: 0,
            roundResult: '',
            revealAllRoles: false,
            word: round.randomWord,
            impostorIds: round.chosenImpostorIds,
        },
    };
}

export function buildImpostorResetUpdates(roomId) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            stateVersion: IMPOSTOR_STATE_VERSION,
            phase: 'lobby',
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            totalImpostors: 0,
            eliminatedImpostors: 0,
            roundResult: '',
            revealAllRoles: false,
        },
        [`${basePath}/private`]: null,
        [`${basePath}/hostOnly`]: null,
    };
}

export function getImpostorPreviousRoundFromHostOnly(hostOnly) {
    return {
        previousImpostorIds: Array.isArray(hostOnly?.impostorIds) ? hostOnly.impostorIds : [],
        previousWord: String(hostOnly?.word || ''),
    };
}
