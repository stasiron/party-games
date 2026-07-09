import catalog from '../data/games/catalog.json';

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
        '../data/games/top-ten.json',
    ],
    { eager: false },
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
    topTen: 'top-ten',
};

const packCache = new Map();

function normalizeModulePath(path) {
    return path.replace(/\\/g, '/');
}

function resolveModulePath(gameId, locale) {
    const candidates = [
        `${gameId}.${locale}.json`,
        `${gameId}.pl.json`,
        `${gameId}.json`,
    ];
    const entries = Object.entries(gameModules);
    for (const fileName of candidates) {
        const suffix = `/games/${fileName}`;
        const match = entries.find(([path]) => normalizeModulePath(path).endsWith(suffix));
        if (match) return match[0];
    }
    return null;
}

async function loadGamePack(gameId, locale) {
    const cacheKey = `${gameId}:${locale}`;
    if (packCache.has(cacheKey)) {
        return packCache.get(cacheKey);
    }
    const modulePath = resolveModulePath(gameId, locale);
    if (!modulePath) {
        packCache.set(cacheKey, null);
        return null;
    }
    const loader = gameModules[modulePath];
    const mod = await loader();
    const pack = mod.default ?? mod;
    packCache.set(cacheKey, pack);
    return pack;
}

export function buildGameContentShell(locale = 'pl') {
    const packs = {};
    for (const key of Object.keys(GAME_FILE_IDS)) {
        packs[key] = null;
    }
    return {
        games: catalog,
        locale,
        ...packs,
    };
}

/**
 * Zwraca pakiet treści gier dla locale z fallbackiem: locale → pl → legacy .json
 * @param {string} [locale='pl']
 */
export async function buildGameContent(locale = 'pl') {
    const packs = {};
    await Promise.all(
        Object.entries(GAME_FILE_IDS).map(async ([key, gameId]) => {
            packs[key] = await loadGamePack(gameId, locale);
        })
    );
    return {
        games: catalog,
        locale,
        ...packs,
    };
}

export default buildGameContentShell('pl');
