import games from '../../data/games/catalog.json';

const catalogById = new Map(games.map((game) => [game.id, game]));

/** Mapa id → gra (domyślnie cały katalog). */
export function buildCatalogIndex(catalogGames = games) {
    const index = new Map();
    for (const game of catalogGames || []) {
        if (!game?.id) continue;
        index.set(game.id, game);
    }
    return index;
}

export function getGameFromCatalog(gameId) {
    return catalogById.get(gameId) ?? null;
}

export function isGameComingSoon(gameOrId) {
    const game = typeof gameOrId === 'string' ? getGameFromCatalog(gameOrId) : gameOrId;
    return game?.comingSoon === true;
}

export function isPlayableGame(gameOrId) {
    const game = typeof gameOrId === 'string' ? getGameFromCatalog(gameOrId) : gameOrId;
    return !!game && !isGameComingSoon(game);
}

/**
 * @param {string | object} gameOrId
 * @param {(key: string, vars?: object, fallback?: string) => string} [t]
 */
export function getComingSoonMessage(gameOrId, t) {
    const game = typeof gameOrId === 'string' ? getGameFromCatalog(gameOrId) : gameOrId;
    if (!game) {
        return t ? t('comingSoon.default') : 'Ta gra jest w trakcie tworzenia. Wróć wkrótce!';
    }
    if (game.comingSoonMessage) return game.comingSoonMessage;
    const name = t
        ? t(`games.${game.id}.name`, {}, game.name)
        : game.name;
    return t
        ? t('comingSoon.named', { name })
        : `🚧 ${game.name} — w trakcie tworzenia. Wybierz inną grę z listy.`;
}

/**
 * Lokalizowane metadane gry (nazwa, opis).
 */
export function getLocalizedGameMeta(gameId, t, fallback = null) {
    return {
        id: gameId,
        name: t(`games.${gameId}.name`, {}, fallback?.name ?? gameId),
        description: t(`games.${gameId}.description`, {}, fallback?.description ?? ''),
        comingSoon: fallback?.comingSoon === true,
    };
}

export function localizeCatalogGames(gamesList, t) {
    return (gamesList || []).map((game) => getLocalizedGameMeta(game.id, t, game));
}
