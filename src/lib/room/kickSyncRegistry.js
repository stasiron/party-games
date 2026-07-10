import { ref, update } from '../rtdb';
import { db } from '../firebase';
import { buildTelepathySyncUpdates } from '../telepathyState';
import { buildJustOneSyncUpdates } from '../justOneState';
import { getKickSyncKind } from './gameRoomContract';

const KICK_SYNC_BUILDERS = {
    telepathy: buildTelepathySyncUpdates,
    'just-one': buildJustOneSyncUpdates,
};

/** Po kicku gracza — sync gameState tylko gdy profil gry tego wymaga. */
export async function runKickSyncAfterRemove(roomId, gameId) {
    const kind = getKickSyncKind(gameId);
    if (!kind) return false;
    const buildSync = KICK_SYNC_BUILDERS[kind];
    if (!buildSync) return false;
    const { updates } = await buildSync(roomId);
    if (!updates || Object.keys(updates).length === 0) return false;
    await update(ref(db), updates);
    return true;
}
