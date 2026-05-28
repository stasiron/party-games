import games from '../data/games/catalog.json';

const DEFAULT_COMING_SOON_MESSAGE = 'Ta gra jest w trakcie tworzenia. Wróć wkrótce!';

const catalogById = new Map(games.map((game) => [game.id, game]));

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

export function getComingSoonMessage(gameOrId) {
    const game = typeof gameOrId === 'string' ? getGameFromCatalog(gameOrId) : gameOrId;
    if (!game) return DEFAULT_COMING_SOON_MESSAGE;
    if (game.comingSoonMessage) return game.comingSoonMessage;
    return `🚧 ${game.name} — w trakcie tworzenia. Wybierz inną grę z listy.`;
}
