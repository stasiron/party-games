/**
 * Lokalizowane metadane gry (nazwa, opis) — treść pytań z osobnych plików JSON.
 * @param {string} gameId
 * @param {(key: string, vars?: object, fallback?: string) => string} t
 * @param {{ name?: string, description?: string, comingSoon?: boolean } | null} [fallback]
 */
export function getLocalizedGameMeta(gameId, t, fallback = null) {
    return {
        id: gameId,
        name: t(`games.${gameId}.name`, {}, fallback?.name ?? gameId),
        description: t(`games.${gameId}.description`, {}, fallback?.description ?? ''),
        comingSoon: fallback?.comingSoon === true,
    };
}

export function localizeCatalogGames(games, t) {
    return (games || []).map((game) => getLocalizedGameMeta(game.id, t, game));
}
