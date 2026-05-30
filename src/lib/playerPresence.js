export const STALE_PRESENCE_MS = 3 * 60 * 1000;
export const RECONNECT_GRACE_MS = 7 * 60 * 1000;
export const VOLUNTARY_LEAVE_GRACE_MS = 15 * 1000;

export function isPlayerActive(player, now = Date.now()) {
    if (!player || player.isKicked === true) return false;
    if (player.leaveReason === 'voluntary') return false;
    if (player.isOnline === false) {
        const offlineSince = Number(player.leftAt || player.lastSeenAt || player.joinedAt || 0);
        if (!offlineSince) return false;
        if (player.leaveReason !== 'disconnect') return false;
        return (now - offlineSince) <= RECONNECT_GRACE_MS;
    }
    const lastSeenAt = Number(player.lastSeenAt || player.joinedAt || 0);
    if (!lastSeenAt) return false;
    return (now - lastSeenAt) <= STALE_PRESENCE_MS;
}

export function shouldRemoveInactivePlayer(player, now = Date.now()) {
    if (!player || player.isKicked === true) return true;
    if (isPlayerActive(player, now)) return false;
    if (player.leaveReason === 'voluntary') return true;
    if (player.isOnline === false) {
        const offlineSince = Number(player.leftAt || player.lastSeenAt || player.joinedAt || 0);
        if (!offlineSince) return true;
        const graceMs = player.leaveReason === 'disconnect'
            ? RECONNECT_GRACE_MS
            : VOLUNTARY_LEAVE_GRACE_MS;
        return (now - offlineSince) >= graceMs;
    }
    const lastSeenAt = Number(player.lastSeenAt || player.joinedAt || 0);
    if (!lastSeenAt) return true;
    return (now - lastSeenAt) > STALE_PRESENCE_MS;
}

export function countActivePlayers(playersMap, now = Date.now()) {
    return Object.values(playersMap || {}).reduce(
        (acc, player) => acc + (isPlayerActive(player, now) ? 1 : 0),
        0
    );
}

export function findRoomHostName(room) {
    if (!room?.players) return '';
    for (const player of Object.values(room.players)) {
        if (player?.isHost === true && player?.isKicked !== true) {
            return String(player.name || '').trim();
        }
    }
    return '';
}
