/** Dynamic importy zgodne z GameRouter — wspólny cache modułów Vite. */
const GAME_CHUNK_LOADERS = {
    'never-have-i-ever': () => import('../games/never-have-i-ever/NeverHaveIEver'),
    impostor: () => import('../games/impostor/Impostor'),
    'truth-or-dare': () => import('../games/truth-or-dare/TruthOrDare'),
    mafia: () => import('../games/mafia/Mafia'),
    'dark-stories': () => import('../games/dark-stories/DarkStories'),
    'who-would-rather': () => import('../games/who-would-rather/WhoWouldRather'),
    'kto-najpredzej': () => import('../games/kto-najpredzej/KtoNajpredzej'),
    telepathy: () => import('../games/telepathy/Telepathy'),
    'just-one': () => import('../games/just-one/JustOne'),
    'sing-it': () => import('../games/sing-it/SingIt'),
};

const prefetched = new Set();

/**
 * Pobiera chunk gry w tle (hover w lobby, znany gameId pokoju).
 * @param {string | null | undefined} gameId
 */
export function prefetchGameChunk(gameId) {
    const id = String(gameId || '').trim();
    const load = GAME_CHUNK_LOADERS[id];
    if (!load || prefetched.has(id)) return;
    prefetched.add(id);
    void load().catch(() => {
        prefetched.delete(id);
    });
}
