import { normalizeAdmission } from './roomAccess';

export function fingerprintRoomPublicEntry(entry) {
    if (!entry?.gameId) return '';
    return [
        entry.gameId,
        entry.joinMode || 'public',
        entry.admission || 'open',
        entry.showCodeInList ? '1' : '0',
        entry.onlineCount ?? 0,
        entry.pendingCount ?? 0,
        String(entry.hostName || '').trim(),
    ].join('|');
}

export function entriesEqual(a, b) {
    return fingerprintRoomPublicEntry(a) === fingerprintRoomPublicEntry(b);
}

/** Sort: opcjonalnie dopasowane filtry na górze, potem więcej graczy online, potem świeższe updatedAt. */
export function sortActiveRooms(rooms, options = {}) {
    const filtersFirst = options.filtersFirst === true;
    return [...rooms].sort((a, b) => {
        if (filtersFirst) {
            const matchDiff = Number(b.matchesFilters) - Number(a.matchesFilters);
            if (matchDiff !== 0) return matchDiff;
        }
        const onlineDiff = (b.onlineCount || 0) - (a.onlineCount || 0);
        if (onlineDiff !== 0) return onlineDiff;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

export function roomMatchesLobbyFilters(room, filters) {
    if (filters?.enabled === false) return true;

    const minOnline = Math.max(0, Number(filters?.minOnline || 0));
    const gameId = String(filters?.gameId || '').trim();
    const hideClosed = filters?.hideClosed !== false;

    if (hideClosed && normalizeAdmission(room) === 'closed') return false;
    if (gameId && room.gameId !== gameId) return false;
    if (room.onlineCount < minOnline) return false;
    return true;
}

/** Oznacza dopasowanie do filtrów i sortuje: pasujące na górze, reszta na końcu. */
export function applyLobbyFilters(rooms, filters) {
    const filtersEnabled = filters?.enabled !== false;
    const annotated = rooms.map((room) => ({
        ...room,
        matchesFilters: roomMatchesLobbyFilters(room, filters),
    }));
    return sortActiveRooms(annotated, { filtersFirst: filtersEnabled });
}
