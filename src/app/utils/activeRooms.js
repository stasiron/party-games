export function buildGameIndex(games) {
    const gameById = new Map();
    for (const game of games || []) {
        if (!game?.id) continue;
        gameById.set(game.id, game);
    }
    return gameById;
}

export function buildActiveRooms(rawRooms, gameById) {
    const list = [];
    const rooms = rawRooms || {};
    for (const [roomId, room] of Object.entries(rooms)) {
        if (!room?.gameId) continue;
        const game = gameById.get(room.gameId);
        if (!game) continue;

        let hasHost = false;
        let onlineCount = 0;
        const players = Object.values(room.players || {});
        for (const player of players) {
            if (!player || player.isKicked === true) continue;
            if (player.isOnline !== false) {
                onlineCount += 1;
                if (player.isHost === true) hasHost = true;
            }
        }
        if (!hasHost) continue;

        list.push({
            roomId,
            gameId: room.gameId,
            gameName: game.name,
            onlineCount,
            isLocked: room.isLocked === true,
        });
    }
    return list;
}
