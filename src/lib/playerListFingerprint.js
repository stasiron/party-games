/**
 * Lekki fingerprint listy graczy — aktualizuj stan tylko gdy zmienia się widoczny skład stołu.
 */
export function fingerprintPlayersMap(playersMap) {
    if (!playersMap || typeof playersMap !== 'object') return '';
    return Object.keys(playersMap)
        .sort()
        .map((id) => {
            const p = playersMap[id];
            if (!p || p.isKicked) return `${id}:kicked`;
            return `${id}:${String(p.name || '')}:${p.isOnline === false ? 0 : 1}:${p.isHost ? 1 : 0}:${p.isGuest ? 1 : 0}`;
        })
        .join('|');
}

export function playersMapToList(playersMap) {
    if (!playersMap || typeof playersMap !== 'object') return [];
    return Object.keys(playersMap)
        .map((key) => ({ id: key, ...playersMap[key] }))
        .filter((p) => !p.isKicked);
}
