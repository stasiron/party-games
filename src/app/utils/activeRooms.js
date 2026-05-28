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
    const now = Date.now();
    const stalePresenceMs = 3 * 60 * 1000;
    for (const [roomId, room] of Object.entries(rooms)) {
        if (!room?.gameId) continue;
        const game = gameById.get(room.gameId);
        if (!game) continue;

        let hasHost = false;
        let onlineCount = 0;
        const players = Object.values(room.players || {});
        for (const player of players) {
            if (!player || player.isKicked === true) continue;
            const lastSeenAt = Number(player.lastSeenAt || player.joinedAt || 0);
            const isActive = player.isOnline !== false && lastSeenAt > 0 && (now - lastSeenAt) <= stalePresenceMs;
            if (isActive) {
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

export function buildActiveRoomsFromPublic(rawRoomsPublic, gameById, existingRoomIds = null) {
    const list = [];
    const rooms = rawRoomsPublic || {};
    for (const [roomId, room] of Object.entries(rooms)) {
        if (!room?.gameId) continue;
        if (existingRoomIds && !existingRoomIds.has(roomId)) continue;
        const game = gameById.get(room.gameId);
        if (!game) continue;
        list.push({
            roomId,
            gameId: room.gameId,
            gameName: game.name,
            onlineCount: Math.max(0, Number(room.onlineCount || 0)),
            isLocked: room.isLocked === true,
        });
    }
    return list;
}
