export const MIN_ROOM_PASSWORD_LENGTH = 2;
export const MAX_ROOM_PASSWORD_LENGTH = 16;

export async function hashRoomPassword(roomId, password) {
    const normalizedRoomId = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normalizedPassword = String(password || '').trim();
    const payload = `${normalizedRoomId}:${normalizedPassword}`;
    const data = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function verifyRoomPassword(roomId, password, passwordHash) {
    if (!passwordHash) return false;
    const candidate = await hashRoomPassword(roomId, password);
    return candidate === passwordHash;
}

export function isValidRoomPassword(password) {
    const len = String(password || '').trim().length;
    return len >= MIN_ROOM_PASSWORD_LENGTH && len <= MAX_ROOM_PASSWORD_LENGTH;
}
