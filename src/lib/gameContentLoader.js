import catalog from '../data/games/catalog.json';

/** Tylko gry z GAME_FILE_IDS — bez JSON „wkrótce” (mniejszy bundle startowy). */
const gameModules = import.meta.glob(
    [
        '../data/games/never-have-i-ever.json',
        '../data/games/truth-or-dare.json',
        '../data/games/impostor.json',
        '../data/games/mafia.json',
        '../data/games/dark-stories.json',
        '../data/games/who-would-rather.json',
        '../data/games/kto-najpredzej.json',
        '../data/games/sing-it.json',
    ],
    { eager: true },
);

/** Mapowanie klucza w gameContent → plik gry (bez rozszerzenia bazowego). */
const GAME_FILE_IDS = {
    neverHaveIEver: 'never-have-i-ever',
    truthOrDare: 'truth-or-dare',
    impostor: 'impostor',
    mafia: 'mafia',
    darkStories: 'dark-stories',
    whoWouldRather: 'who-would-rather',
    ktoNajpredzej: 'kto-najpredzej',
    singIt: 'sing-it',
};

function normalizeModulePath(path) {
    return path.replace(/\\/g, '/');
}

function resolveGamePack(gameId, locale) {
    const candidates = [
        `${gameId}.${locale}.json`,
        `${gameId}.pl.json`,
        `${gameId}.json`,
    ];

    const entries = Object.entries(gameModules);
    for (const fileName of candidates) {
        const suffix = `/games/${fileName}`;
        const match = entries.find(([path]) => normalizeModulePath(path).endsWith(suffix));
        if (match) {
            return match[1].default;
        }
    }
    return null;
}

/**
 * Zwraca pakiet treści gier dla locale z fallbackiem: locale → pl → legacy .json
 * @param {string} [locale='pl']
 */
export function buildGameContent(locale = 'pl') {
    const packs = {};
    for (const [key, gameId] of Object.entries(GAME_FILE_IDS)) {
        packs[key] = resolveGamePack(gameId, locale);
    }
    return {
        games: catalog,
        ...packs,
    };
}

export default buildGameContent('pl');
