export {
    normalizeTelepathyWord as normalizeJustOneWord,
    areTelepathyWordsEqual as areJustOneWordsEqual,
} from '../telepathy/telepathyUtils';

import { normalizeTelepathyWord } from '../telepathy/telepathyUtils';
import { getPlayerNameById } from '../../lib/guestPlayers';

/** @typedef {{ round: number, clues: Record<string, string> }} JustOneRoundEntry */

/**
 * Zlicza wystąpienia znormalizowanych słów we wszystkich turach.
 * @param {JustOneRoundEntry[] | null | undefined} clueHistory
 * @returns {Map<string, number>}
 */
export function buildJustOneNormCounts(clueHistory) {
    const counts = new Map();
    const history = Array.isArray(clueHistory) ? clueHistory : [];

    for (const entry of history) {
        const clues = entry?.clues && typeof entry.clues === 'object' ? entry.clues : {};
        for (const raw of Object.values(clues)) {
            const norm = normalizeTelepathyWord(raw);
            if (!norm) continue;
            counts.set(norm, (counts.get(norm) || 0) + 1);
        }
    }

    return counts;
}

/** Normy występujące więcej niż raz (w tej lub poprzednich turach). */
export function getDuplicatedNorms(clueHistory) {
    const duplicated = new Set();
    for (const [norm, count] of buildJustOneNormCounts(clueHistory)) {
        if (count > 1) duplicated.add(norm);
    }
    return duplicated;
}

/**
 * Słowa widoczne dla nasłuchiwacza w bieżącej turze (po odsłonięciu).
 * @param {JustOneRoundEntry[] | null | undefined} clueHistory
 * @param {Record<string, string> | null | undefined} currentClues
 */
export function getVisibleCluesForListener(clueHistory, currentClues) {
    const history = Array.isArray(clueHistory) ? [...clueHistory] : [];
    const clues = currentClues && typeof currentClues === 'object' ? currentClues : {};
    const withCurrent = [...history, { round: -1, clues }];

    const duplicated = getDuplicatedNorms(withCurrent);
    const visible = {};

    for (const [playerId, raw] of Object.entries(clues)) {
        const norm = normalizeTelepathyWord(raw);
        if (!norm || duplicated.has(norm)) {
            visible[playerId] = null;
        } else {
            visible[playerId] = typeof raw === 'string' ? raw.trim() : '';
        }
    }

    return visible;
}

/** Etykiety słów już użyte w grze (do listy „nie powtarzaj”). */
export function getJustOneUsedClueLabels(clueHistory) {
    const history = Array.isArray(clueHistory) ? clueHistory : [];
    const normToDisplay = new Map();

    for (const entry of history) {
        const clues = entry?.clues && typeof entry.clues === 'object' ? entry.clues : {};
        for (const raw of Object.values(clues)) {
            const norm = normalizeTelepathyWord(raw);
            if (!norm || normToDisplay.has(norm)) continue;
            const display = typeof raw === 'string' ? raw.trim() : '';
            normToDisplay.set(norm, display || norm);
        }
    }

    return [...normToDisplay.values()];
}

/** Czy znormalizowane słowo było już użyte w dowolnej turze. */
export function isJustOneClueForbidden(clueHistory, candidate) {
    const norm = normalizeTelepathyWord(candidate);
    if (!norm) return false;
    return buildJustOneNormCounts(clueHistory).has(norm);
}

/**
 * Wszystkie zakończone tury — podpowiedzi per gracz (widoczne + powtórzenia).
 * @param {JustOneRoundEntry[] | null | undefined} clueHistory
 * @param {string[]} clueGiverIds
 */
export function getJustOneListenerRounds(clueHistory, clueGiverIds) {
    const history = Array.isArray(clueHistory) ? clueHistory : [];
    const ids = [...new Set((clueGiverIds || []).filter(Boolean))];
    if (!history.length || !ids.length) return [];

    return history.map((entry, index) => {
        const prior = history.slice(0, index);
        const clues = entry?.clues && typeof entry.clues === 'object' ? entry.clues : {};
        const visible = getVisibleCluesForListener(prior, clues);

        return {
            round: entry.round ?? index + 1,
            entries: ids.map((playerId) => {
                const raw = typeof clues[playerId] === 'string' ? clues[playerId].trim() : '';
                const vis = visible[playerId];
                return {
                    playerId,
                    raw,
                    visible: vis,
                    isDuplicate: Boolean(raw && !vis),
                };
            }),
        };
    });
}

/**
 * Siatka nasłuchiwacza: wiersze = podawcy, kolumny = tury.
 * @param {ReturnType<typeof getJustOneListenerRounds>} listenerRounds
 */
export function buildJustOneListenerClueGrid(listenerRounds) {
    if (!listenerRounds.length) {
        return { playerIds: [], rounds: [], cellByKey: new Map() };
    }

    const playerIds = listenerRounds[0].entries.map((e) => e.playerId);
    const rounds = listenerRounds.map((block) => block.round);
    /** @type {Map<string, { raw: string, visible: string | null, isDuplicate: boolean }>} */
    const cellByKey = new Map();

    for (const roundBlock of listenerRounds) {
        for (const entry of roundBlock.entries) {
            cellByKey.set(`${entry.playerId}:${roundBlock.round}`, {
                raw: entry.raw,
                visible: entry.visible,
                isDuplicate: entry.isDuplicate,
            });
        }
    }

    return { playerIds, rounds, cellByKey };
}

/** Ostatnia zakończona tura — podpowiedzi widoczne dla nasłuchiwacza. */
export function getLastCompletedRoundForListener(clueHistory) {
    const history = Array.isArray(clueHistory) ? clueHistory : [];
    if (history.length === 0) {
        return { round: 0, visible: {}, clues: {} };
    }
    const last = history[history.length - 1];
    const prior = history.slice(0, -1);
    const clues = last?.clues && typeof last.clues === 'object' ? last.clues : {};
    return {
        round: last.round ?? history.length,
        clues,
        visible: getVisibleCluesForListener(prior, clues),
    };
}

/** Rekord graczy z RTDB → lista do filtrowania online/offline. */
export function roomPlayersRecordToSubmitList(playersRecord) {
    return Object.entries(playersRecord || {})
        .filter(([, p]) => p && p.isKicked !== true)
        .map(([id, p]) => ({ id, ...p }));
}

/**
 * Podawcy, od których realnie czekamy wpisu (bez nasłuchiwacza; online lub gość z online właścicielem).
 * @param {Array<{ id: string, isGuest?: boolean, isOnline?: boolean, isKicked?: boolean, linkedToPlayerId?: string }>} tablePlayers
 * @param {string[]} clueGiverIds
 * @param {string | null | undefined} listenerId
 */
export function filterJustOneRequiredClueGivers(tablePlayers, clueGiverIds, listenerId = null) {
    const byId = new Map((tablePlayers || []).map((p) => [p.id, p]));
    return (clueGiverIds || []).filter((id) => {
        if (listenerId && id === listenerId) return false;
        const player = byId.get(id);
        if (!player || player.isKicked === true) return false;
        if (player.isGuest === true) {
            const owner = player.linkedToPlayerId ? byId.get(player.linkedToPlayerId) : null;
            return Boolean(owner && owner.isKicked !== true && owner.isOnline !== false);
        }
        return player.isOnline !== false;
    });
}

/** Nasłuchiwacz nie podaje podpowiedzi — zawsze traktowany jak „oddany”. */
export function isJustOneClueSubmitted(submitted, playerId, listenerId = null) {
    if (listenerId && playerId === listenerId) return true;
    return submitted?.[playerId] === true;
}

/** Mapa submitted z nasłuchiwaczem ustawionym na true (do zapisu RTDB). */
export function buildJustOneSubmittedMap(listenerId, existing = {}) {
    const map = existing && typeof existing === 'object' ? { ...existing } : {};
    if (listenerId) map[listenerId] = true;
    return map;
}

/** Imiona graczy, od których jeszcze brakuje podpowiedzi (do UI). */
export function getJustOnePendingClueGiverNames(tablePlayers, clueGiverIds, listenerId, submitted) {
    return filterJustOneRequiredClueGivers(tablePlayers, clueGiverIds, listenerId)
        .filter((id) => !isJustOneClueSubmitted(submitted, id, listenerId))
        .map((id) => getPlayerNameById(tablePlayers, id))
        .filter(Boolean)
        .join(', ');
}

/** Wszyscy wymagani podawcy zatwierdzili słowo (nasłuchiwacz i offline nie blokują tury). */
export function allClueGiversSubmitted(
    clueGiverIds,
    submitted,
    tablePlayers = null,
    listenerId = null
) {
    const required =
        tablePlayers != null
            ? filterJustOneRequiredClueGivers(tablePlayers, clueGiverIds, listenerId)
            : (clueGiverIds || []).filter((id) => !listenerId || id !== listenerId);
    if (!clueGiverIds?.length) return false;
    if (!required.length) return true;
    return required.every((id) => isJustOneClueSubmitted(submitted, id, listenerId));
}

/** Wszyscy podawcy z RTDB (np. sync admina) — bez filtrowania online. */
export function allClueGiversSubmittedRaw(clueGiverIds, submitted) {
    if (!clueGiverIds.length) return false;
    const map = submitted && typeof submitted === 'object' ? submitted : {};
    return clueGiverIds.every((id) => map[id] === true);
}

export function pickDifferentListener(playerIds, previousListenerId) {
    if (!playerIds.length) return null;
    const others = playerIds.filter((id) => id !== previousListenerId);
    const pool = others.length > 0 ? others : playerIds;
    return pool[Math.floor(Math.random() * pool.length)];
}

/** Stabilny wybór nasłuchiwacza (bez losowania przy każdym renderze). */
export function pickStableListener(playerIds, previousListenerId) {
    const sorted = [...new Set((playerIds || []).filter(Boolean))].sort();
    if (!sorted.length) return null;
    const others = sorted.filter((id) => id !== previousListenerId);
    const pool = others.length > 0 ? others : sorted;
    return pool[0];
}

/**
 * Spójne role przy stole — nasłuchiwacz musi być wśród aktywnych, zostaje ≥1 podawca.
 * @param {string[]} activeIds
 * @param {string | null | undefined} listenerId
 * @param {string | null | undefined} previousListenerId
 */
export function resolveJustOneClueGivers(activeIds, listenerId, previousListenerId = null) {
    const ids = [...new Set((activeIds || []).filter(Boolean))];
    if (ids.length === 0) {
        return { listenerId: null, clueGiverIds: [] };
    }

    let listener =
        typeof listenerId === 'string' && ids.includes(listenerId) ? listenerId : null;
    if (!listener) {
        listener = pickStableListener(ids, previousListenerId);
    }

    let clueGiverIds = ids.filter((id) => id !== listener);
    if (clueGiverIds.length === 0 && ids.length > 1) {
        listener = pickStableListener(ids, listener);
        clueGiverIds = ids.filter((id) => id !== listener);
    }

    clueGiverIds = clueGiverIds.filter((id) => id !== listener);

    return { listenerId: listener, clueGiverIds };
}

export function pickSecretWord(wordsByCategory, categoryIds, previousWord = '') {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return null;

    const MAX_RETRY = 25;
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
