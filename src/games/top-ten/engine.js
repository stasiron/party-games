const MAX_RETRY = 25;

function shuffleArray(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function pickDifferentStartingPlayer(playerIds, previousStartingPlayerId) {
    let nextStartingPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
        nextStartingPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        if (nextStartingPlayerId !== previousStartingPlayerId || playerIds.length === 1) break;
    }
    return nextStartingPlayerId;
}

function pickDifferentWord(wordsByCategory, categoryIds, previousWord) {
    let chosenCatId = categoryIds[0];
    let randomWord = previousWord;
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
        chosenCatId = categoryIds[Math.floor(Math.random() * categoryIds.length)];
        const words = (wordsByCategory[chosenCatId] ?? []).filter(
            (w) => typeof w === 'string' && w.length > 0 && w.length <= 64
        );
        if (words.length === 0) continue;
        randomWord = words[Math.floor(Math.random() * words.length)];
        if (randomWord !== previousWord || words.length === 1) break;
    }
    const finalWords = (wordsByCategory[chosenCatId] ?? []).filter(
        (w) => typeof w === 'string' && w.length > 0 && w.length <= 64
    );
    if (finalWords.length === 0 || !randomWord || randomWord.length > 64) return null;
    return { chosenCatId, randomWord };
}

/** Losuje unikalne liczby 1–10 (tyle ile graczy, max 10). */
export function assignUniqueRatings(playerIds) {
    const count = Math.min(playerIds.length, 10);
    const pool = shuffleArray(Array.from({ length: 10 }, (_, i) => i + 1)).slice(0, count);
    const shuffledIds = shuffleArray(playerIds);
    const ratingsByPlayerId = {};
    shuffledIds.forEach((pid, index) => {
        ratingsByPlayerId[pid] = pool[index];
    });
    return ratingsByPlayerId;
}

export function buildRoundState({
    playerIds,
    previousStartingPlayerId = null,
    previousWord = '',
    categoryIds,
    wordsByCategory,
}) {
    if (!Array.isArray(playerIds) || playerIds.length < 2) return null;
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return null;

    const pickedWord = pickDifferentWord(wordsByCategory, categoryIds, previousWord);
    if (!pickedWord) return null;

    const startingPlayerId = pickDifferentStartingPlayer(playerIds, previousStartingPlayerId);
    const ratingsByPlayerId = assignUniqueRatings(playerIds);

    return {
        startingPlayerId,
        chosenCatId: pickedWord.chosenCatId,
        randomWord: pickedWord.randomWord,
        ratingsByPlayerId,
    };
}
