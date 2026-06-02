/** Ile poprzednich tur pokazywać przy nazwie gracza. */
export const TELEPATHY_PREVIOUS_GUESSES_DISPLAY = 3;

/** Pauza po odsłonięciu, zanim host przełączy na kolejną turę (auto). */
export const TELEPATHY_AUTO_ROUND_DELAY_MS = 4000;

/** Mapowanie polskich (i kilku europejskich) znaków → ASCII przed porównaniem. */
const LETTER_FOLD = {
    ą: 'a',
    ć: 'c',
    ę: 'e',
    ł: 'l',
    ń: 'n',
    ó: 'o',
    ś: 's',
    ż: 'z',
    ź: 'z',
    ä: 'a',
    ö: 'o',
    ü: 'u',
    ß: 'ss',
};

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const WHITESPACE_AND_ZERO_WIDTH = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u200B-\u200D\uFEFF]+/g;
/** Po złożeniu znaków: tylko litery/cyfry ASCII (wystarczy dla haseł po polsku). */
const NON_ASCII_LETTER_OR_DIGIT = /[^a-z0-9]/g;

export function isTelepathyAutoRoundEnabled(gameState) {
    return gameState?.autoRound !== false;
}

export function coerceTelepathyRawWord(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
}

/**
 * Klucz do porównań, dopasowania i listy zabronionych słów.
 * Ignoruje: wielkość liter, spacje, znaki specjalne, polskie znaki (ą/a, ę/e, …).
 */
export function normalizeTelepathyWord(word) {
    let s = coerceTelepathyRawWord(word).normalize('NFKC').toLowerCase();

    s = [...s].map((ch) => LETTER_FOLD[ch] ?? ch).join('');

    s = s.normalize('NFD').replace(COMBINING_MARKS, '');

    s = s.replace(WHITESPACE_AND_ZERO_WIDTH, '');
    s = s.replace(NON_ASCII_LETTER_OR_DIGIT, '');

    return s;
}

export function areTelepathyWordsEqual(a, b) {
    const na = normalizeTelepathyWord(a);
    const nb = normalizeTelepathyWord(b);
    if (!na || !nb) return false;
    return na === nb;
}

export function isWordAlreadyUsed(candidate, usedWords) {
    const normalized = normalizeTelepathyWord(candidate);
    if (!normalized) return false;
    const list = Array.isArray(usedWords) ? usedWords : [];
    return list.some((entry) => normalizeTelepathyWord(entry) === normalized);
}

/** Wszyscy aktywni przy stole podali słowo. */
export function allPlayersSubmitted(participantIds, submitted) {
    if (!participantIds.length) return false;
    const map = submitted && typeof submitted === 'object' ? submitted : {};
    return participantIds.every((id) => map[id] === true);
}

/** Czy po odsłonięciu wszyscy wpisali to samo (po normalizacji). */
export function allWordsMatch(revealedWords, participantIds) {
    if (!participantIds.length) return false;

    const normalized = participantIds.map((id) =>
        normalizeTelepathyWord(revealedWords?.[id])
    );
    if (normalized.some((w) => !w)) return false;

    const first = normalized[0];
    return normalized.every((w) => w === first);
}

/** @param {Record<string, string[]> | null | undefined} playerWordHistory */
export function getPlayerWordList(playerWordHistory, playerId) {
    const list = playerWordHistory?.[playerId];
    return Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.trim()) : [];
}

/**
 * Słowa z zakończonych tur + bieżąca odsłonięta tura.
 * @param {Record<string, string[]> | null | undefined} playerWordHistory
 * @param {Record<string, string> | null | undefined} revealedWords
 */
export function getTelepathyRevealDisplay(playerWordHistory, revealedWords, playerId) {
    const history = getPlayerWordList(playerWordHistory, playerId);
    const revealed = coerceTelepathyRawWord(revealedWords?.[playerId]).trim();

    const current = revealed || history[history.length - 1] || '';

    const historyWithoutCurrent =
        revealed && history[history.length - 1] === revealed
            ? history.slice(0, -1)
            : history;

    const previous = historyWithoutCurrent.slice(-TELEPATHY_PREVIOUS_GUESSES_DISPLAY);
    return { current, previous };
}

/** Ostatnie zakończone tury (bez bieżącej) — widoczne także między turami. */
export function getTelepathyCompletedGuesses(playerWordHistory, playerId) {
    return getPlayerWordList(playerWordHistory, playerId).slice(
        -TELEPATHY_PREVIOUS_GUESSES_DISPLAY
    );
}

/**
 * Wiersz tablicy graczy — zawsze widoczny w trakcie gry.
 * W fazie wpisywania bieżące słowo jest ukryte (? / —).
 */
export function getTelepathyBoardRow(
    playerWordHistory,
    revealedWords,
    playerId,
    phase,
    submitted
) {
    const isRevealPhase = phase === 'revealed' || phase === 'won';
    if (isRevealPhase) {
        const { current, previous } = getTelepathyRevealDisplay(
            playerWordHistory,
            revealedWords,
            playerId
        );
        return {
            current,
            previous,
            currentHidden: false,
            currentPending: false,
        };
    }

    const completed = getPlayerWordList(playerWordHistory, playerId);
    const hasSubmitted = submitted?.[playerId] === true;
    return {
        previous: completed.slice(-TELEPATHY_PREVIOUS_GUESSES_DISPLAY),
        current: '',
        currentHidden: hasSubmitted,
        currentPending: !hasSubmitted,
    };
}

/** @param {Record<string, string[]> | null | undefined} playerWordHistory */
export function appendPlayerWordHistory(playerWordHistory, playerId, rawWord) {
    const trimmed = coerceTelepathyRawWord(rawWord).trim();
    if (!trimmed) return playerWordHistory || {};

    const next = { ...(playerWordHistory || {}) };
    const prev = getPlayerWordList(next, playerId);
    next[playerId] = [...prev, trimmed];
    return next;
}
