import { useState, useCallback, useMemo, memo } from 'react';
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
import { recordNewPlayerJoin } from '../lib/appMetrics.js';
import { useLocale } from '../locales/LocaleContext';

function GuestPlayersPanel({ roomId, playersList, myPlayerId, runWithBusy, embedded = false }) {
    const { t } = useLocale();
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
            setGuestError(t('guestPlayers.errorEmptyName'));
            return;
        }

        if (onlinePlayers.length === 0) {
            setGuestError(t('guestPlayers.errorNeedPhonePlayer'));
            return;
        }

        const taken = playersList.some(
            (p) => p.name?.trim().toLowerCase() === cleaned.toLowerCase()
        );
        if (taken) {
            setGuestError(t('guestPlayers.errorNameTaken'));
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
                recordNewPlayerJoin({
                    isGuest: true,
                    dedupeKey: `${roomId}:${newRef.key}`,
                });
                setGuestName('');
                setGuestError('');
            } catch (err) {
                console.error(err);
                setGuestError(t('guestPlayers.errorAddFailed'));
            }
        });
    }, [guestName, playersList, roomId, runWithBusy, onlinePlayers.length, myPlayerId, t]);

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

    const panelBody = (
        <>
            <p className="guest-players-panel__hint">
                {t('guestPlayers.hint')}
            </p>

            <div className="guest-players-panel__add">
                <input
                    type="text"
                    value={guestName}
                    onChange={(e) => {
                        setGuestName(e.target.value);
                        setGuestError('');
                    }}
                    placeholder={t('guestPlayers.namePlaceholder')}
                    onKeyDown={(e) => e.key === 'Enter' && addGuest()}
                    aria-label={t('guestPlayers.nameAria')}
                    disabled={onlinePlayers.length === 0}
                />
                <button
                    type="button"
                    onClick={addGuest}
                    disabled={guestName.trim() === '' || onlinePlayers.length === 0}
                >
                    {t('guestPlayers.addButton')}
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
                                    title={t('guestPlayers.removeTitle', { name: guest.name })}
                                >
                                    {t('common.remove')}
                                </button>
                            </div>
                            <div className="guest-players-panel__link">
                                <span className="guest-players-panel__link-title">{t('guestPlayers.sharesPhoneWith')}</span>
                                <div className="guest-link-chips" role="group" aria-label={t('guestPlayers.phoneForAria', { name: guest.name })}>
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
                                                {p.id === myPlayerId ? t('guestPlayers.youSuffix') : ''}
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
                                {owner.id === myPlayerId ? t('guestPlayers.summaryYou') : ''}
                                <span className="guest-players-panel__summary-arrow"> → </span>
                                {linked.map((g) => g.name).join(', ')}
                            </p>
                        );
                    })}
                </div>
            )}
        </>
    );

    if (embedded) {
        return (
            <div className="guest-players-panel guest-players-panel--embedded room-invite__section">
                <p className="room-invite__section-title">
                    {t('guestPlayers.sectionTitle')}{guestCountLabel}
                </p>
                {panelBody}
            </div>
        );
    }

    return (
        <CollapsibleSection
            className="guest-players-panel"
            toggleLabel={`${t('guestPlayers.toggleShow')}${guestCountLabel}`}
            toggleLabelOpen={`${t('guestPlayers.toggleHide')}${guestCountLabel}`}
            defaultOpen={false}
        >
            {panelBody}
        </CollapsibleSection>
    );
}

export default memo(GuestPlayersPanel);
