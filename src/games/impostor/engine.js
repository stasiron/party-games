import {
    getImpostorWeights,
    pickWeightedWithoutReplacement,
    buildUpdatedRoleHistory,
} from '../../lib/roleFairness';

const MAX_RETRY = 25;

function sameMembers(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value) => right.includes(value));
}

function pickDifferentStartingPlayer(playerIds, previousStartingPlayerId) {
    let nextStartingPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
        nextStartingPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        if (nextStartingPlayerId !== previousStartingPlayerId || playerIds.length === 1) break;
    }
    return nextStartingPlayerId;
}

function pickDifferentImpostors(playerIds, impostorCount, weights, previousImpostorIds) {
    let chosenImpostorIds = [];
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
        chosenImpostorIds = pickWeightedWithoutReplacement(playerIds, impostorCount, weights);
        if (!sameMembers(chosenImpostorIds, previousImpostorIds) || playerIds.length <= impostorCount) {
            break;
        }
    }
    return chosenImpostorIds;
}

function pickDifferentWord(wordsByCategory, categoryIds, previousWord) {
    let chosenCatId = categoryIds[0];
    let randomWord = previousWord;
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
        chosenCatId = categoryIds[Math.floor(Math.random() * categoryIds.length)];
        const words = wordsByCategory[chosenCatId] ?? [];
        if (words.length === 0) return null;
        randomWord = words[Math.floor(Math.random() * words.length)];
        if (randomWord !== previousWord || words.length === 1) break;
    }
    return { chosenCatId, randomWord };
}

export function buildRoundState({
    playerIds,
    desiredImpostorCount,
    previousImpostorIds = [],
    previousStartingPlayerId = null,
    previousWord = '',
    categoryIds,
    wordsByCategory,
    roleHistory,
    fairnessEnabled,
    randomImpostorCount = false,
    randomImpostorMaxCount = 1,
    selectedImpostorCount = 1,
}) {
    if (!Array.isArray(playerIds) || playerIds.length < 2) return null;
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return null;

    const maxPossibleImpostors = Math.max(1, playerIds.length - 1);
    const randomHardMax = Math.max(1, playerIds.length);
    const effectiveRandomMax = Math.min(randomHardMax, Math.max(1, randomImpostorMaxCount));
    const effectiveImpostorCount = Number.isInteger(desiredImpostorCount) && desiredImpostorCount > 0
        ? Math.min(desiredImpostorCount, maxPossibleImpostors)
        : randomImpostorCount
            ? Math.floor(Math.random() * effectiveRandomMax) + 1
            : Math.min(selectedImpostorCount, maxPossibleImpostors);

    const weights = getImpostorWeights(playerIds, roleHistory, fairnessEnabled);
    const chosenImpostorIds = pickDifferentImpostors(
        playerIds,
        effectiveImpostorCount,
        weights,
        previousImpostorIds
    );
    const startingPlayerId = pickDifferentStartingPlayer(playerIds, previousStartingPlayerId);
    const pickedWord = pickDifferentWord(wordsByCategory, categoryIds, previousWord);
    if (!pickedWord) return null;

    const updatedHistory = buildUpdatedRoleHistory(roleHistory, chosenImpostorIds, playerIds);
    return {
        chosenImpostorIds,
        startingPlayerId,
        chosenCatId: pickedWord.chosenCatId,
        randomWord: pickedWord.randomWord,
        updatedHistory,
    };
}
