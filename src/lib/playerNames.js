export function getActivePlayerNames(tablePlayers) {
    if (!Array.isArray(tablePlayers)) return [];
    const names = [];
    for (const player of tablePlayers) {
        if (!player || player.isKicked) continue;
        const normalizedName = String(player.name || '').trim();
        if (!normalizedName) continue;
        names.push(normalizedName);
    }
    return names;
}

export function pickRandomPlayerName(tablePlayers, excludeName = null) {
    const allNames = getActivePlayerNames(tablePlayers);
    if (allNames.length === 0) return 'Gracz';
    if (excludeName && allNames.length > 1) {
        const filtered = allNames.filter((name) => name !== excludeName);
        if (filtered.length > 0) {
            return filtered[Math.floor(Math.random() * filtered.length)];
        }
    }
    return allNames[Math.floor(Math.random() * allNames.length)];
}
