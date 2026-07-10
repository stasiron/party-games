import { roomDeleteUpdates } from './roomIndex';

export const PLAYER_PRESENCE_ROOT = 'playerPresenceByAuthUid';

export function buildPlayerLeaveUpdates(roomId, playerId) {
    if (!roomId || !playerId) return {};
    return { [`rooms/${roomId}/players/${playerId}`]: null };
}

export function buildJoinRequestRemoveUpdates(roomId, requestId) {
    if (!roomId || !requestId) return {};
    return { [`rooms/${roomId}/joinRequests/${requestId}`]: null };
}

export function buildPresenceClearUpdatesForPlayers(playersData, excludePlayerId = null) {
    const updates = {};
    if (!playersData || typeof playersData !== 'object') return updates;
    Object.entries(playersData).forEach(([playerId, player]) => {
        if (playerId === excludePlayerId) return;
        const authUid = player?.authUid;
        if (authUid) {
            updates[`${PLAYER_PRESENCE_ROOT}/${authUid}`] = null;
        }
    });
    return updates;
}

/** Pełne skasowanie pokoju + presence pozostałych graczy. */
export function buildFullRoomCloseUpdates(roomId, playersData = null, excludePlayerId = null) {
    if (!roomId) return {};
    return {
        ...roomDeleteUpdates(roomId),
        ...buildPresenceClearUpdatesForPlayers(playersData, excludePlayerId),
    };
}
