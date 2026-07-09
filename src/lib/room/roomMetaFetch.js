import { ref, get } from '../rtdb';
import { db } from '../firebase';
import { normalizeJoinMode, normalizeAdmission, showRoomCodeInList } from '../roomAccess';

/**
 * Lekki odczyt metadanych pokoju bez gameState / hostOnly / private.
 */
export async function fetchRoomMeta(roomId) {
    const base = `rooms/${roomId}`;
    const [gameIdSnap, joinModeSnap, admissionSnap, showCodeSnap, passwordHashSnap, createdAtSnap] =
        await Promise.all([
            get(ref(db, `${base}/gameId`)),
            get(ref(db, `${base}/joinMode`)),
            get(ref(db, `${base}/admission`)),
            get(ref(db, `${base}/showCodeInList`)),
            get(ref(db, `${base}/passwordHash`)),
            get(ref(db, `${base}/createdAt`)),
        ]);

    const gameId = gameIdSnap.val();
    if (!gameId) return null;

    const raw = {
        gameId,
        joinMode: joinModeSnap.val(),
        admission: admissionSnap.val(),
        showCodeInList: showCodeSnap.val(),
        passwordHash: passwordHashSnap.val(),
        createdAt: createdAtSnap.val(),
    };

    return {
        gameId,
        joinMode: normalizeJoinMode(raw),
        admission: normalizeAdmission(raw),
        showCodeInList: showRoomCodeInList(raw),
        passwordHash: raw.passwordHash ?? null,
        createdAt: raw.createdAt ?? null,
    };
}
