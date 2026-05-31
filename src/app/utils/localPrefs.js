import { NICKNAME_KEY, LAST_ROOM_KEY, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../constants';

export function loadLocalNickname() {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(NICKNAME_KEY) || '';
}

export function loadLastRoomId() {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(LAST_ROOM_KEY) || '';
}

export function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[idx];
    }
    return code;
}
