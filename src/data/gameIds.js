import games from './games/catalog.json';
import { isPlayableGame } from '../lib/gameCatalog.js';

/** Stare linki / angielska nazwa → kanoniczny id z catalog.json */
const GAME_ID_ALIASES = {
    'would-you-rather': 'who-would-rather',
};

const knownIds = new Set(games.map((g) => g.id));

export function resolveGameId(rawId) {
    const id = String(rawId || '').trim();
    if (!id) return null;
    if (knownIds.has(id)) return id;
    const aliased = GAME_ID_ALIASES[id];
    return aliased && knownIds.has(aliased) ? aliased : null;
}

export function isKnownGameId(rawId) {
    return resolveGameId(rawId) !== null;
}

/** Do tworzenia pokoju i wejścia z ?game= — bez gier „wkrótce”. */
export function isPlayableGameId(rawId) {
    const id = resolveGameId(rawId);
    return id ? isPlayableGame(id) : false;
}
