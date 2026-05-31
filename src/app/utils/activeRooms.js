import { RECONNECT_GRACE_MS } from '../../lib/playerPresence';
import {
    getAdmissionListBadge,
    getJoinModeListBadge,
    normalizeAdmission,
    normalizeJoinMode,
    showRoomCodeInList,
} from '../../lib/roomAccess';

/** Lista aktywnych pokoi wyłącznie z lekkiego indeksu roomsPublic. */
export function buildActiveRoomsFromPublic(rawRoomsPublic, gameById) {
    const list = [];
    const rooms = rawRoomsPublic || {};
    const now = Date.now();
    const stalePublicMs = RECONNECT_GRACE_MS;
    for (const [roomId, room] of Object.entries(rooms)) {
        if (!room?.gameId) continue;
        const game = gameById.get(room.gameId);
        if (!game) continue;

        const hostName = String(room.hostName || '').trim();
        const onlineCount = Math.max(0, Number(room.onlineCount || 0));
        const joinMode = normalizeJoinMode(room);
        const admission = normalizeAdmission(room);

        if (onlineCount <= 0) continue;
        const updatedAt = Number(room.updatedAt || 0);
        if (updatedAt > 0 && (now - updatedAt) > stalePublicMs) continue;

        list.push({
            roomId,
            gameId: room.gameId,
            gameName: game.name,
            hostName,
            onlineCount,
            joinMode,
            admission,
            joinModeBadge: getJoinModeListBadge(joinMode),
            admissionBadge: getAdmissionListBadge(admission),
            showCode: showRoomCodeInList(room),
            pendingCount: Math.max(0, Number(room.pendingCount || 0)),
            updatedAt,
        });
    }
    return list;
}

/** Porównanie listy pokoi przed setState (mniej mrugania UI). */
export function fingerprintActiveRoomsList(rooms) {
    if (!rooms?.length) return '';
    return rooms
        .map((r) => [
            r.roomId,
            r.onlineCount,
            r.pendingCount,
            r.matchesFilters ? 1 : 0,
        ].join(':'))
        .join('|');
}
