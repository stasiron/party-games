/** Ścieżki RTDB do czyszczenia sekretów gry (role, słowa, ratingi). */
export function roomSecretWipePaths(roomId) {
    if (!roomId) return {};
    return {
        [`rooms/${roomId}/hostOnly`]: null,
        [`rooms/${roomId}/private`]: null,
    };
}
