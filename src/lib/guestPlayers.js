/** Gracz bez telefonu — dodany przez hosta, nigdy nie łączy się z aplikacją. */
export function isGuestPlayer(player) {
    return player?.isGuest === true;
}

/** Wszyscy przy stole (online + goście), bez wyrzuconych. */
export function getTablePlayers(players) {
    return (players || []).filter((p) => !p.isKicked);
}

/** Indeks pomocniczy do ograniczenia wielu przebiegów po tej samej liście graczy. */
export function buildPlayersIndex(players) {
    const tablePlayers = getTablePlayers(players);
    const byId = new Map();
    const guestsByOwner = new Map();
    const nameToGuest = new Set();

    for (const player of tablePlayers) {
        byId.set(player.id, player);
        if (!isGuestPlayer(player)) continue;

        const ownerId = player.linkedToPlayerId;
        if (ownerId) {
            const ownerGuests = guestsByOwner.get(ownerId) || [];
            ownerGuests.push(player);
            guestsByOwner.set(ownerId, ownerGuests);
        }
        const normalizedName = player.name?.trim().toLowerCase();
        if (normalizedName) {
            nameToGuest.add(normalizedName);
        }
    }

    return {
        tablePlayers,
        byId,
        guestsByOwner,
        nameToGuest,
    };
}

/** Gracze z własnym telefonem (nie goście). */
export function getOnlineTablePlayers(players) {
    return getTablePlayers(players).filter((p) => !isGuestPlayer(p) && p.isOnline !== false);
}

/** Goście przypisani do właściciela telefonu. */
export function getGuestsForOwner(players, ownerPlayerId) {
    if (!ownerPlayerId) return [];
    const { guestsByOwner } = buildPlayersIndex(players);
    return guestsByOwner.get(ownerPlayerId) || [];
}

/** Czy gracz o danym id jest gościem powiązanym z właścicielem telefonu. */
export function isGuestOfOwner(players, guestPlayerId, ownerPlayerId) {
    const { byId } = buildPlayersIndex(players);
    const guest = byId.get(guestPlayerId);
    return isGuestPlayer(guest) && guest.linkedToPlayerId === ownerPlayerId;
}

/** Nazwa gracza po id (gość lub online). */
export function getPlayerNameById(players, playerId) {
    const { byId } = buildPlayersIndex(players);
    const p = byId.get(playerId);
    return p?.name ?? null;
}

/** Czy bieżąca kolejka dotyczy mnie lub gościa na moim telefonie. */
export function isTurnForPhoneOwner(players, myPlayerId, currentPlayerName) {
    if (!currentPlayerName?.trim() || !myPlayerId) return false;
    const normalizedTurnName = currentPlayerName.trim().toLowerCase();
    const { byId, guestsByOwner } = buildPlayersIndex(players);
    const me = byId.get(myPlayerId);
    if (me?.name?.trim().toLowerCase() === normalizedTurnName) return true;
    const guests = guestsByOwner.get(myPlayerId) || [];
    return guests.some((guest) => guest.name?.trim().toLowerCase() === normalizedTurnName);
}

/** Domyślny właściciel telefonu dla nowego gościa (host > najmniej gości > pierwszy online). */
export function pickDefaultPhoneOwner(players, preferredOwnerId) {
    const indexed = buildPlayersIndex(players);
    const online = indexed.tablePlayers.filter((p) => !isGuestPlayer(p) && p.isOnline !== false);
    if (online.length === 0) return null;

    if (preferredOwnerId && online.some((p) => p.id === preferredOwnerId)) {
        return preferredOwnerId;
    }

    let best = online[0];
    let minGuests = (indexed.guestsByOwner.get(best.id) || []).length;
    for (const p of online) {
        const count = (indexed.guestsByOwner.get(p.id) || []).length;
        if (count < minGuests) {
            minGuests = count;
            best = p;
        }
    }
    return best.id;
}

/** Czy wylosowana osoba to gość bez własnego telefonu. */
export function isCurrentPlayerGuest(players, currentPlayerName) {
    if (!currentPlayerName?.trim()) return false;
    const norm = currentPlayerName.trim().toLowerCase();
    const { nameToGuest } = buildPlayersIndex(players);
    return nameToGuest.has(norm);
}
