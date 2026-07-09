import {
    JOIN_MODES,
    normalizeAdmission,
    normalizeJoinMode,
    showRoomCodeInList,
} from './roomAccess';

/** Lekki indeks pokoi do listy gościa — bez gameState i graczy. */
export const ROOMS_PUBLIC_ROOT = 'roomsPublic';

export function buildRoomPublicEntry({
    gameId,
    joinMode = 'public',
    admission = 'open',
    onlineCount = 0,
    hostName = '',
    pendingCount = 0,
    showCodeInList,
    updatedAt = Date.now(),
}) {
    const resolvedJoinMode = JOIN_MODES.includes(joinMode)
        ? joinMode
        : normalizeJoinMode({ joinMode });
    const resolvedAdmission = normalizeAdmission({ admission });
    const resolvedShowCode = typeof showCodeInList === 'boolean'
        ? showCodeInList
        : showRoomCodeInList({ joinMode: resolvedJoinMode, showCodeInList });
    return {
        gameId,
        joinMode: resolvedJoinMode,
        admission: resolvedAdmission,
        showCodeInList: resolvedShowCode,
        onlineCount: Math.max(0, Number(onlineCount || 0)),
        pendingCount: Math.max(0, Number(pendingCount || 0)),
        updatedAt,
        ...(hostName ? { hostName: String(hostName).trim() } : {}),
    };
}

export function roomPublicPath(roomId) {
    return `${ROOMS_PUBLIC_ROOT}/${roomId}`;
}

export function roomDeleteUpdates(roomId) {
    return {
        [`rooms/${roomId}`]: null,
        [roomPublicPath(roomId)]: null,
    };
}

export function roomsPurgeAllUpdates() {
    return {
        rooms: null,
        [ROOMS_PUBLIC_ROOT]: null,
    };
}
