import { useState, useCallback, useMemo } from 'react';
import { ref, push, remove } from 'firebase/database';
import { set } from '../lib/rtdb';
import { db } from '../lib/firebase';
import {
    isGuestPlayer,
    getOnlineTablePlayers,
    getGuestsForOwner,
    pickDefaultPhoneOwner,
} from '../lib/guestPlayers';
import CollapsibleSection from './CollapsibleSection';

function GuestPlayersPanel({ roomId, playersList, myPlayerId, runWithBusy }) {
    const [guestName, setGuestName] = useState('');
    const [guestError, setGuestError] = useState('');

    const onlinePlayers = useMemo(
        () => getOnlineTablePlayers(playersList),
        [playersList]
    );

    const guests = useMemo(
        () => playersList.filter((p) => isGuestPlayer(p)),
        [playersList]
    );

    const addGuest = useCallback(async () => {
        const cleaned = guestName.trim();
        if (!cleaned) {
            setGuestError('Podaj imię gościa.');
            return;
        }

        if (onlinePlayers.length === 0) {
            setGuestError('Najpierw dołącz do pokoju co najmniej jeden gracz z telefonem.');
            return;
        }

        const taken = playersList.some(
            (p) => p.name?.trim().toLowerCase() === cleaned.toLowerCase()
        );
        if (taken) {
            setGuestError('Ta nazwa jest już zajęta przy stole.');
            return;
        }

        const defaultOwnerId = pickDefaultPhoneOwner(playersList, myPlayerId);

        await runWithBusy(async () => {
            try {
                const newRef = push(ref(db, `rooms/${roomId}/players`));
                await set(newRef, {
                    name: cleaned,
                    isGuest: true,
                    isHost: false,
                    isOnline: false,
                    isKicked: false,
                    linkedToPlayerId: defaultOwnerId,
                    joinedAt: Date.now(),
                });
                setGuestName('');
                setGuestError('');
            } catch (err) {
                console.error(err);
                setGuestError('Nie udało się dodać gościa.');
            }
        });
    }, [guestName, playersList, roomId, runWithBusy, onlinePlayers.length, myPlayerId]);

    const linkGuestToOwner = useCallback(
        async (guestId, ownerId) => {
            if (!ownerId) return;
            await runWithBusy(async () => {
                await set(
                    ref(db, `rooms/${roomId}/players/${guestId}/linkedToPlayerId`),
                    ownerId
                );
            });
        },
        [roomId, runWithBusy]
    );

    const removeGuest = useCallback(
        async (guestId) => {
            await runWithBusy(async () => {
                await remove(ref(db, `rooms/${roomId}/players/${guestId}`));
            });
        },
        [roomId, runWithBusy]
    );

    const guestCountLabel = guests.length > 0 ? ` (${guests.length})` : '';

    return (
        <CollapsibleSection
            className="guest-players-panel"
            toggleLabel={`▼ Goście bez telefonu (współdzielenie)${guestCountLabel}`}
            toggleLabelOpen={`▲ Ukryj gości bez telefonu${guestCountLabel}`}
            defaultOpen={false}
        >
            <p className="guest-players-panel__hint">
                Dodaj osoby bez aplikacji. Nowy gość jest od razu przypisany do telefonu — możesz to
                zmienić poniżej.
            </p>

            <div className="guest-players-panel__add">
                <input
                    type="text"
                    value={guestName}
                    onChange={(e) => {
                        setGuestName(e.target.value);
                        setGuestError('');
                    }}
                    placeholder="Imię gościa…"
                    onKeyDown={(e) => e.key === 'Enter' && addGuest()}
                    aria-label="Imię gościa"
                    disabled={onlinePlayers.length === 0}
                />
                <button
                    type="button"
                    onClick={addGuest}
                    disabled={guestName.trim() === '' || onlinePlayers.length === 0}
                >
                    Dodaj gościa
                </button>
            </div>
            {guestError && <p className="error-message">{guestError}</p>}

            {guests.length > 0 && (
                <ul className="guest-players-panel__list">
                    {guests.map((guest) => (
                        <li key={guest.id} className="guest-players-panel__item">
                            <div className="guest-players-panel__item-header">
                                <span className="guest-players-panel__name">
                                    {guest.name}
                                    <span className="guest-players-panel__badge">📵</span>
                                </span>
                                <button
                                    type="button"
                                    className="guest-players-panel__remove"
                                    onClick={() => removeGuest(guest.id)}
                                    title={`Usuń gościa ${guest.name}`}
                                >
                                    Usuń
                                </button>
                            </div>
                            <div className="guest-players-panel__link">
                                <span className="guest-players-panel__link-title">Współdzieli telefon z</span>
                                <div className="guest-link-chips" role="group" aria-label={`Telefon dla ${guest.name}`}>
                                    {onlinePlayers.map((p) => {
                                        const isActive = guest.linkedToPlayerId === p.id;
                                        return (
                                            <button
                                                key={p.id}
                                                type="button"
                                                className={`guest-link-chip ${isActive ? 'guest-link-chip--active' : ''}`}
                                                onClick={() => linkGuestToOwner(guest.id, p.id)}
                                                aria-pressed={isActive}
                                            >
                                                {p.name}
                                                {p.id === myPlayerId ? ' · Ty' : ''}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {onlinePlayers.length > 0 && guests.some((g) => g.linkedToPlayerId) && (
                <div className="guest-players-panel__summary">
                    {onlinePlayers.map((owner) => {
                        const linked = getGuestsForOwner(playersList, owner.id);
                        if (linked.length === 0) return null;
                        return (
                            <p key={owner.id}>
                                <strong>{owner.name}</strong>
                                {owner.id === myPlayerId ? ' (Ty)' : ''}
                                <span className="guest-players-panel__summary-arrow"> → </span>
                                {linked.map((g) => g.name).join(', ')}
                            </p>
                        );
                    })}
                </div>
            )}
        </CollapsibleSection>
    );
}

export default GuestPlayersPanel;
