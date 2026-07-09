import { ref, get, update } from '../rtdb';
import { db } from '../firebase';
import { roomPublicPath } from './roomIndex';
import {
    isPlayerActive,
    shouldRemoveInactivePlayer,
} from '../playerPresence';

export const ORPHAN_ROOM_TTL_MS = 5 * 60 * 1000;
export const EMPTY_ROOM_TTL_MS = 3 * 60 * 1000;
export const ABANDONED_ROOM_TTL_MS = 90 * 1000;
export const ROOM_CLEANUP_COOLDOWN_MS = 30 * 1000;
export const BACKGROUND_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const CLEANUP_LEASE_PATH = '_maintenance/roomsCleanupLease';
export const CLEANUP_LEASE_TTL_MS = 3 * 60 * 1000;
export const PRESENCE_INDEX_ROOT = 'playerPresenceByAuthUid';

/**
 * Czy ten klient powinien uruchamiać cleanup pokoi (nie obciążaj gości w cudzym pokoju).
 */
export function shouldRunClientRoomsCleanup({ isJoined, effectiveIsHost, hasAdminPowers }) {
    if (hasAdminPowers) return true;
    if (!isJoined) return true;
    return effectiveIsHost;
}

/**
 * Buduje mapę update'ów RTDB do usunięcia nieaktywnych graczy i starych pokoi.
 * @returns {Record<string, null>}
 */
export function buildRoomsCleanupUpdates(rawRooms, rawRoomsPublic, now = Date.now()) {
    const raw = rawRooms || {};
    const publicRaw = rawRoomsPublic || {};
    const cleanupUpdates = {};

    Object.entries(raw).forEach(([roomId, room]) => {
        if (!room?.gameId) return;
        const playersEntries = Object.entries(room.players || {});
        const activePlayers = [];

        playersEntries.forEach(([playerId, player]) => {
            if (!player || player.isKicked === true) {
                cleanupUpdates[`rooms/${roomId}/players/${playerId}`] = null;
                if (player?.authUid) {
                    cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                }
                return;
            }
            if (shouldRemoveInactivePlayer(player, now)) {
                cleanupUpdates[`rooms/${roomId}/players/${playerId}`] = null;
                if (player.authUid) {
                    cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                }
                return;
            }
            if (isPlayerActive(player, now)) {
                activePlayers.push(player);
            }
        });

        const hasActiveHost = activePlayers.some((player) => player.isHost === true);
        const ageMs = Math.max(0, now - Number(room.createdAt || 0));
        const publicEntry = publicRaw[roomId];
        const publicAgeMs = publicEntry
            ? Math.max(0, now - Number(publicEntry.updatedAt || room.createdAt || 0))
            : ageMs;
        const neverHadPlayers = playersEntries.length === 0;
        const emptyRoomTtl = neverHadPlayers ? ABANDONED_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
        const isEmptyTooLong = activePlayers.length === 0 && (
            ageMs >= emptyRoomTtl || publicAgeMs >= emptyRoomTtl
        );
        const isOrphanTooLong = !hasActiveHost && ageMs >= ORPHAN_ROOM_TTL_MS;

        if (isEmptyTooLong || isOrphanTooLong) {
            cleanupUpdates[`rooms/${roomId}`] = null;
            cleanupUpdates[roomPublicPath(roomId)] = null;
            playersEntries.forEach(([, player]) => {
                if (player?.authUid) {
                    cleanupUpdates[`${PRESENCE_INDEX_ROOT}/${player.authUid}`] = null;
                }
            });
        }
    });

    Object.entries(publicRaw).forEach(([roomId, publicEntry]) => {
        if (!publicEntry?.gameId) return;
        if (raw[roomId]) return;
        const publicAgeMs = Math.max(0, now - Number(publicEntry.updatedAt || 0));
        const onlineCount = Math.max(0, Number(publicEntry.onlineCount || 0));
        if (onlineCount <= 0 && publicAgeMs >= ABANDONED_ROOM_TTL_MS) {
            cleanupUpdates[roomPublicPath(roomId)] = null;
        }
    });

    return cleanupUpdates;
}

export function buildOrphanRoomsPublicUpdates(rawRoomsPublic, rawRooms) {
    const publicEntries = Object.entries(rawRoomsPublic || {});
    if (publicEntries.length === 0) return {};
    const roomIds = new Set(Object.keys(rawRooms || {}));
    const orphanUpdates = {};
    for (const [roomId] of publicEntries) {
        if (!roomIds.has(roomId)) {
            orphanUpdates[roomPublicPath(roomId)] = null;
        }
    }
    return orphanUpdates;
}

export async function applyRoomsCleanupUpdates(cleanupUpdates) {
    if (!cleanupUpdates || Object.keys(cleanupUpdates).length === 0) return false;
    await update(ref(db), cleanupUpdates);
    return true;
}

export async function runRoomsCleanupFromSnapshots(rawRooms, rawRoomsPublic, now = Date.now()) {
    const cleanupUpdates = buildRoomsCleanupUpdates(rawRooms, rawRoomsPublic, now);
    return applyRoomsCleanupUpdates(cleanupUpdates);
}

export async function cleanupOrphanRoomsPublicFromSnapshots(rawRoomsPublic, rawRooms) {
    const orphanUpdates = buildOrphanRoomsPublicUpdates(rawRoomsPublic, rawRooms);
    return applyRoomsCleanupUpdates(orphanUpdates);
}

/**
 * Pobiera dane pokoi do cleanup bez get(/rooms) — tylko wpisy z indeksu public + opcjonalne id.
 */
export async function fetchRoomsForCleanup(rawRoomsPublic, extraRoomIds = []) {
    const roomIds = new Set([
        ...Object.keys(rawRoomsPublic || {}),
        ...extraRoomIds.filter(Boolean),
    ]);
    const rooms = {};
    await Promise.all(
        [...roomIds].map(async (roomId) => {
            try {
                const [gameIdSnap, createdAtSnap, playersSnap] = await Promise.all([
                    get(ref(db, `rooms/${roomId}/gameId`)),
                    get(ref(db, `rooms/${roomId}/createdAt`)),
                    get(ref(db, `rooms/${roomId}/players`)),
                ]);
                const gameId = gameIdSnap.val();
                if (!gameId) return;
                rooms[roomId] = {
                    gameId,
                    createdAt: createdAtSnap.val(),
                    players: playersSnap.val(),
                };
            } catch {
                /* best effort */
            }
        })
    );
    return rooms;
}
