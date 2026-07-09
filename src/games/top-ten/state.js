export const TOP_TEN_STATE_VERSION = 1;

export function isLegacyTopTenState(gameState) {
    if (!gameState || gameState.phase === 'lobby') return false;
    if (Number(gameState.stateVersion) >= TOP_TEN_STATE_VERSION) return false;
    return Boolean(gameState.word) || Boolean(gameState.ratings);
}

export function usesTopTenPrivacyModel(gameState) {
    return Number(gameState?.stateVersion) >= TOP_TEN_STATE_VERSION;
}

export function buildTopTenPrivacyUpdates(roomId, playerIds, round, publicFields) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    updates[`${basePath}/gameState`] = {
        stateVersion: TOP_TEN_STATE_VERSION,
        phase: 'peeking',
        categoryName: publicFields.categoryName,
        startingPlayerId: round.startingPlayerId,
        categoryIds: publicFields.categoryIds,
        roleRevealEpoch: publicFields.roleRevealEpoch,
        playerOrder: publicFields.playerOrder,
        orderingMode: publicFields.orderingMode ?? 'shared-step',
        revealRatings: false,
    };

    updates[`${basePath}/hostOnly`] = {
        word: round.randomWord,
        chosenCatId: round.chosenCatId,
        ratings: round.ratingsByPlayerId,
    };

    for (const pid of playerIds) {
        updates[`${basePath}/private/${pid}`] = {
            word: round.randomWord,
            rating: round.ratingsByPlayerId[pid] ?? null,
        };
    }

    return updates;
}

export function buildTopTenPrivacyPatchUpdates(roomId, playerIds, round, publicFields) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    Object.assign(updates, {
        [`${basePath}/gameState/categoryName`]: publicFields.categoryName,
        [`${basePath}/gameState/startingPlayerId`]: round.startingPlayerId,
        [`${basePath}/gameState/phase`]: 'peeking',
        [`${basePath}/gameState/roleRevealEpoch`]: publicFields.roleRevealEpoch,
        [`${basePath}/gameState/playerOrder`]: publicFields.playerOrder,
        [`${basePath}/gameState/orderingMode`]: publicFields.orderingMode ?? 'shared-step',
        [`${basePath}/gameState/revealRatings`]: false,
        [`${basePath}/gameState/stateVersion`]: TOP_TEN_STATE_VERSION,
    });

    updates[`${basePath}/hostOnly`] = {
        word: round.randomWord,
        chosenCatId: round.chosenCatId,
        ratings: round.ratingsByPlayerId,
    };

    for (const pid of playerIds) {
        updates[`${basePath}/private/${pid}`] = {
            word: round.randomWord,
            rating: round.ratingsByPlayerId[pid] ?? null,
        };
    }

    return updates;
}

export function buildTopTenLegacyStartUpdates(roomId, round, publicFields) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            phase: 'peeking',
            categoryName: publicFields.categoryName,
            startingPlayerId: round.startingPlayerId,
            categoryIds: publicFields.categoryIds,
            roleRevealEpoch: publicFields.roleRevealEpoch,
            playerOrder: publicFields.playerOrder,
            orderingMode: publicFields.orderingMode ?? 'shared-step',
            revealRatings: false,
            word: round.randomWord,
            ratings: round.ratingsByPlayerId,
        },
    };
}

export function buildTopTenResetUpdates(roomId) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            stateVersion: TOP_TEN_STATE_VERSION,
            phase: 'lobby',
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            playerOrder: null,
            revealRatings: false,
            revealedRatings: null,
        },
        [`${basePath}/hostOnly`]: null,
        [`${basePath}/private`]: null,
    };
}

export function getTopTenPreviousRoundFromHostOnly(hostOnly) {
    return {
        previousWord: hostOnly?.word ?? '',
        previousRatings: hostOnly?.ratings ?? null,
    };
}

export function buildOrderingPhaseStartUpdates(roomId, playerIds, shuffledOrder, orderingMode) {
    const basePath = `rooms/${roomId}`;
    const firstTurnPlayerId = shuffledOrder?.[0] ?? playerIds[0] ?? null;
    const updates = {
        [`${basePath}/gameState/phase`]: 'ordering',
        [`${basePath}/gameState/orderingSubmitted`]: null,
        [`${basePath}/gameState/orderingSwapsUsed`]: null,
        [`${basePath}/gameState/orderingTurnPlayerId`]: firstTurnPlayerId,
        [`${basePath}/gameState/orderingAgreed`]: null,
    };

    if (orderingMode === 'individual') {
        for (const pid of playerIds) {
            updates[`${basePath}/private/${pid}/topTenOrder`] = shuffledOrder;
            updates[`${basePath}/private/${pid}/topTenSubmitted`] = false;
        }
    } else {
        updates[`${basePath}/gameState/playerOrder`] = shuffledOrder;
    }

    return updates;
}
