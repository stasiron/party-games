import { useState, useCallback, useMemo, useEffect } from 'react';
import { ref } from 'firebase/database';
import { set, get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.js';
import { getImpostorCategories, getCategoryLabel } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { useRoomSettings } from '../../lib/useRoomSettings';
import { buildRoundState } from './engine';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';
import SharedPhoneRoleReveal from '../../components/SharedPhoneRoleReveal';

const DEFAULT_SETTINGS = { fairnessEnabled: false };

function Impostor({
    isHost,
    onLeave,
    onCloseRoom,
    myPlayerId,
    tablePlayers = [],
    roomInviteUrl,
    isRoomLocked = false,
    roomId,
}) {
    const playableCategories = useMemo(
        () => getImpostorCategories(gameData.impostor),
        []
    );

    const lobbyPlayerCount = useMemo(() => getTablePlayers(tablePlayers).length, [tablePlayers]);

    const myLinkedGuests = useMemo(
        () => getGuestsForOwner(tablePlayers, myPlayerId),
        [tablePlayers, myPlayerId]
    );

    const maxImpostors = Math.max(1, lobbyPlayerCount - 1);

    const [selectedCategories, setSelectedCategories] = useState([]);
    const [impostorCount, setImpostorCount] = useState(1);
    const [randomImpostorCount, setRandomImpostorCount] = useState(false);
    const [randomImpostorMaxCount, setRandomImpostorMaxCount] = useState(maxImpostors);
    const [showRole, setShowRole] = useState(false);

    useEffect(() => {
        if (impostorCount <= maxImpostors) return undefined;
        const t = setTimeout(() => setImpostorCount(Math.max(1, maxImpostors)), 0);
        return () => clearTimeout(t);
    }, [impostorCount, maxImpostors]);

    const effectiveRandomImpostorMaxCount = useMemo(() => {
        const hardMax = Math.max(1, lobbyPlayerCount);
        return Math.min(hardMax, Math.max(1, randomImpostorMaxCount));
    }, [lobbyPlayerCount, randomImpostorMaxCount]);

    const roomSettings = useRoomSettings(roomId, DEFAULT_SETTINGS);

    const defaultRoomState = useMemo(
        () => ({
            phase: 'lobby',
            word: '',
            impostorIds: [],
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            totalImpostors: 0,
            eliminatedImpostors: 0,
            roundResult: '',
        }),
        []
    );

    const roomData = useRoomGameState(roomId, defaultRoomState, { mergeDefaults: true });
    const roleRevealEpoch = roomData.roleRevealEpoch ?? 0;

    usePiGameSession(roomData.phase !== 'lobby');

    const impostorIds = useMemo(() => {
        if (Array.isArray(roomData.impostorIds) && roomData.impostorIds.length > 0) {
            return roomData.impostorIds;
        }
        if (roomData.impostorId) {
            return [roomData.impostorId];
        }
        return [];
    }, [roomData.impostorIds, roomData.impostorId]);

    const toggleCategory = useCallback((catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
        );
    }, []);

    const changeImpostorCount = useCallback(
        (delta) => {
            if (randomImpostorCount) {
                setRandomImpostorMaxCount((prev) => {
                    const hardMax = Math.max(1, lobbyPlayerCount);
                    const next = prev + delta;
                    if (next < 1) return 1;
                    if (next > hardMax) return hardMax;
                    return next;
                });
                return;
            }
            setImpostorCount((prev) => {
                const next = prev + delta;
                if (next < 1) return 1;
                if (next > maxImpostors) return maxImpostors;
                return next;
            });
        },
        [maxImpostors, randomImpostorCount, lobbyPlayerCount]
    );

    const toggleFairness = useCallback(() => {
        set(ref(db, `rooms/${roomId}/settings/fairnessEnabled`), !roomSettings.fairnessEnabled);
    }, [roomSettings.fairnessEnabled, roomId]);

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;

        const playersRef = ref(db, `rooms/${roomId}/players`);
        const snapshot = await get(playersRef);
        const playersData = snapshot.val();

        if (!playersData) return;

        const playerIds = Object.keys(playersData);
        if (playerIds.length < 2) return;

        const historySnap = await get(ref(db, `rooms/${roomId}/roleHistory`));
        const roleHistory = historySnap.val();
        const nextRound = buildRoundState({
            playerIds,
            categoryIds: selectedCategories,
            wordsByCategory: gameData.impostor.words,
            roleHistory,
            fairnessEnabled: roomSettings.fairnessEnabled,
            randomImpostorCount,
            randomImpostorMaxCount: effectiveRandomImpostorMaxCount,
            selectedImpostorCount: impostorCount,
        });
        if (!nextRound) return;
        const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);

        await Promise.all([
            set(ref(db, `rooms/${roomId}/roleHistory`), nextRound.updatedHistory),
            set(ref(db, `rooms/${roomId}/gameState`), {
                phase: 'peeking',
                word: nextRound.randomWord,
                impostorIds: nextRound.chosenImpostorIds,
                categoryName: catNameDisplay,
                startingPlayerId: nextRound.startingPlayerId,
                categoryIds: selectedCategories,
                roleRevealEpoch: 1,
                totalImpostors: nextRound.chosenImpostorIds.length,
                eliminatedImpostors: 0,
                roundResult: '',
                revealAllRoles: false,
            })
        ]);
    }, [
        selectedCategories,
        playableCategories,
        impostorCount,
        randomImpostorCount,
        effectiveRandomImpostorMaxCount,
        roomSettings.fairnessEnabled,
        roomId
    ]);

    const drawNextWord = useCallback(async () => {
        const categoryIds =
            Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
                ? roomData.categoryIds
                : selectedCategories;

        if (categoryIds.length === 0) return;

        const playersRef = ref(db, `rooms/${roomId}/players`);
        const playersSnapshot = await get(playersRef);
        const playersData = playersSnapshot.val();
        if (!playersData) return;

        const playerIds = Object.keys(playersData);
        if (playerIds.length < 2) return;

        const previousStartingPlayerId = roomData.startingPlayerId ?? null;
        const previousImpostorIds = Array.isArray(roomData.impostorIds)
            ? roomData.impostorIds
            : roomData.impostorId
                ? [roomData.impostorId]
                : [];

        const desiredCountFromState =
            Number.isInteger(roomData.totalImpostors) && roomData.totalImpostors > 0
                ? roomData.totalImpostors
                : impostorCount;
        const effectiveImpostorCount = Math.min(desiredCountFromState, Math.max(1, playerIds.length - 1));
        const historySnap = await get(ref(db, `rooms/${roomId}/roleHistory`));
        const roleHistory = historySnap.val();

        const nextRound = buildRoundState({
            playerIds,
            desiredImpostorCount: effectiveImpostorCount,
            previousImpostorIds,
            previousStartingPlayerId,
            previousWord: roomData.word,
            categoryIds,
            wordsByCategory: gameData.impostor.words,
            roleHistory,
            fairnessEnabled: roomSettings.fairnessEnabled,
        });
        if (!nextRound) return;
        const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);

        await Promise.all([
            set(ref(db, `rooms/${roomId}/roleHistory`), nextRound.updatedHistory),
            update(ref(db, `rooms/${roomId}/gameState`), {
                word: nextRound.randomWord,
                impostorIds: nextRound.chosenImpostorIds,
                categoryName: catNameDisplay,
                startingPlayerId: nextRound.startingPlayerId,
                phase: 'peeking',
                roleRevealEpoch: roleRevealEpoch + 1,
                totalImpostors: nextRound.chosenImpostorIds.length,
                eliminatedImpostors: 0,
                roundResult: '',
                revealAllRoles: false,
            })
        ]);
        setShowRole(false);
    }, [
        roomData.categoryIds,
        roomData.word,
        roomData.impostorIds,
        roomData.impostorId,
        roomData.startingPlayerId,
        roomData.totalImpostors,
        selectedCategories,
        playableCategories,
        roleRevealEpoch,
        impostorCount,
        roomSettings.fairnessEnabled,
        roomId
    ]);

    const canDrawNextWord =
        (Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0) ||
        selectedCategories.length > 0;

    const startDiscussion = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState/phase`), 'discussing');
        setShowRole(false);
    }, [roomId]);

    const replayRoles = useCallback(async () => {
        if (isRoomLocked) return;
        await update(ref(db, `rooms/${roomId}/gameState`), {
            phase: 'peeking',
            roleRevealEpoch: roleRevealEpoch + 1,
        });
        setShowRole(false);
    }, [isRoomLocked, roleRevealEpoch, roomId]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), {
            phase: 'lobby',
            word: '',
            impostorIds: [],
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            totalImpostors: 0,
            eliminatedImpostors: 0,
            roundResult: '',
            revealAllRoles: false,
        });
        setSelectedCategories([]);
        setShowRole(false);
    }, [roomId]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        if (isHost && onCloseRoom) {
            onCloseRoom();
            return;
        }
        onLeave();
    }, [forceResetTable, isHost, onCloseRoom, onLeave]);

    const updateEliminatedImpostors = useCallback(
        async (delta) => {
            if (!isHost) return;
            const total = Math.max(
                0,
                Number.isInteger(roomData.totalImpostors) ? roomData.totalImpostors : impostorIds.length
            );
            const current = Math.max(
                0,
                Number.isInteger(roomData.eliminatedImpostors) ? roomData.eliminatedImpostors : 0
            );
            const next = Math.min(total, Math.max(0, current + delta));
            if (next === current) return;
            const updates = {
                eliminatedImpostors: next,
            };
            if (next >= total && total > 0) {
                updates.roundResult = '✅ Wygrywacie! Wyrzucono wszystkich Impostorów.';
                updates.phase = 'discussing';
            }
            await update(ref(db, `rooms/${roomId}/gameState`), updates);
        },
        [isHost, roomData.totalImpostors, roomData.eliminatedImpostors, impostorIds.length, roomId]
    );

    const amIImpostor = impostorIds.includes(myPlayerId);

    const isGuestImpostor = useCallback(
        (guestId) => impostorIds.includes(guestId),
        [impostorIds]
    );

    const startingPlayerName = useMemo(() => {
        if (!roomData.startingPlayerId) return null;
        const player = tablePlayers.find((p) => p.id === roomData.startingPlayerId);
        return player?.name ?? 'Nieznany gracz';
    }, [roomData.startingPlayerId, tablePlayers]);

    const canStart =
        selectedCategories.length > 0 &&
        lobbyPlayerCount >= 2 &&
        (!randomImpostorCount
            ? impostorCount <= maxImpostors
            : effectiveRandomImpostorMaxCount >= 1 && effectiveRandomImpostorMaxCount <= lobbyPlayerCount);
    const revealAllRoles = roomData.revealAllRoles === true && roomData.phase !== 'lobby';

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    <GameRules title="🕵️ Impostor">
                        <ol className="game-rules__list">
                            <li>Host losuje słowo i Impostorów. Wszyscy podglądają swoją rolę na telefonie.</li>
                            <li>Gracze znają hasło — bez kategorii. Impostor widzi tylko kategorię, z której pochodzi słowo.</li>
                            <li>Losowany jest gracz, który zaczyna skojarzenia; kolejność dalej idzie jak siedzicie.</li>
                            <li>Po rundzie dyskusji głosujecie, kto jest Impostorem. Trafiona osoba przegrywa rundę.</li>
                        </ol>
                    </GameRules>

                    {isHost ? (
                        <>
                            <div className="impostor-room-settings">
                                <h3 className="impostor-room-settings__title">Ustawienia pokoju</h3>
                                <button
                                    type="button"
                                    className="settings-toggle impostor-fairness-toggle"
                                    onClick={toggleFairness}
                                    aria-pressed={roomSettings.fairnessEnabled}
                                >
                                    <span className="impostor-fairness-toggle__text">
                                        <strong>Sprawiedliwe losowanie</strong>
                                        <span className="impostor-fairness-toggle__hint">
                                            {roomSettings.fairnessEnabled
                                                ? 'Większa szansa dla graczy, którzy dawno nie byli Impostorem — bez powtórek z poprzedniej rundy.'
                                                : 'Czysta losowość — każdy ma równe szanse co rundę.'}
                                        </span>
                                    </span>
                                    <span
                                        className={`settings-toggle__icon ${roomSettings.fairnessEnabled ? 'on' : 'off'}`}
                                    >
                                        {roomSettings.fairnessEnabled ? '✔' : '✕'}
                                    </span>
                                </button>
                            </div>

                            <div className="impostor-impostor-count-box">
                                <h3 className="impostor-impostor-count-title">Liczba Impostorów</h3>
                                <button
                                    type="button"
                                    className="settings-toggle impostor-random-toggle"
                                    onClick={() =>
                                        setRandomImpostorCount((prev) => {
                                            const next = !prev;
                                            if (next) {
                                                const defaultMax = Math.max(1, lobbyPlayerCount - 1);
                                                const hardMax = Math.max(1, lobbyPlayerCount);
                                                setRandomImpostorMaxCount(Math.min(hardMax, defaultMax));
                                            }
                                            return next;
                                        })
                                    }
                                    aria-pressed={randomImpostorCount}
                                >
                                    <span>Losowa liczba Impostorów co rundę</span>
                                    <span className={`settings-toggle__icon ${randomImpostorCount ? 'on' : 'off'}`}>
                                        {randomImpostorCount ? '✔' : '✕'}
                                    </span>
                                </button>
                                <div className="impostor-impostor-count-row">
                                    <button
                                        type="button"
                                        onClick={() => changeImpostorCount(-1)}
                                        className="btn-impostor-counter"
                                        disabled={
                                            randomImpostorCount
                                                ? effectiveRandomImpostorMaxCount <= 1
                                                : impostorCount <= 1
                                        }
                                    >
                                        −
                                    </button>
                                    <span className="impostor-impostor-count-value">
                                        {randomImpostorCount ? effectiveRandomImpostorMaxCount : impostorCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => changeImpostorCount(1)}
                                        className="btn-impostor-counter"
                                        disabled={
                                            randomImpostorCount
                                                ? effectiveRandomImpostorMaxCount >= Math.max(1, lobbyPlayerCount)
                                                : impostorCount >= maxImpostors
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                                <p className="impostor-impostor-count-hint">
                                    {randomImpostorCount
                                        ? `Graczy przy stole: ${lobbyPlayerCount} (losowanie 1-${effectiveRandomImpostorMaxCount} Impostorów, max ${Math.max(1, lobbyPlayerCount)})`
                                        : `Graczy przy stole: ${lobbyPlayerCount} (max ${maxImpostors} Impostorów)`}
                                </p>
                            </div>

                            <p>Wybierz kategorie dla tej rundy (możesz kilka):</p>
                            <div className="games-grid categories-grid">
                                {playableCategories.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id)}
                                            className={
                                                isSelected ? 'category-btn-selected' : 'category-btn-unselected'
                                            }
                                        >
                                            <span className="game-title">{cat.name}</span>
                                            <span className="game-desc">{cat.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedCategories.length > 0 && (
                                <div className="actions-stack">
                                    <button
                                        onClick={startGame}
                                        className="btn-accent"
                                        disabled={!canStart}
                                    >
                                        Wylosuj z {selectedCategories.length} kategorii i rozdaj role
                                    </button>
                                    {lobbyPlayerCount < 2 && (
                                        <p className="impostor-start-hint text-error">
                                            Potrzebujesz co najmniej 2 graczy przy stole.
                                        </p>
                                    )}
                                </div>
                            )}
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze kategorie i wylosuje role...</p>
                    )}
                </div>
            ) : (
                <div>
                    {revealAllRoles && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">ADMIN REVEAL: Role ujawnione</h2>
                            <div className="players-list">
                                {getTablePlayers(tablePlayers).map((player) => (
                                    <span key={player.id} className="player-tag">
                                        {player.name}: {impostorIds.includes(player.id) ? 'IMPOSTOR' : 'GRACZ'}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {startingPlayerName && (
                        <p className="impostor-starting-player">
                            Zaczyna: <strong>{startingPlayerName}</strong>
                        </p>
                    )}
                    {roomData.roundResult && (
                        <p className="impostor-starting-player">{roomData.roundResult}</p>
                    )}

                    {roomData.phase === 'peeking' && (
                        <>
                            <p className="impostor-peeking-header">Faza sprawdzania ról</p>
                            {myLinkedGuests.length > 0 ? (
                                <SharedPhoneRoleReveal
                                    resetEpoch={roleRevealEpoch}
                                    guests={myLinkedGuests}
                                    ownerPeekClassName={
                                        amIImpostor ? 'impostor-bg-bad' : 'impostor-bg-good'
                                    }
                                    renderOwnerReveal={() => (
                                        <>
                                            <h2
                                                className={`impostor-role-title ${amIImpostor ? 'text-danger' : 'text-success'}`}
                                            >
                                                {amIImpostor ? 'JESTEŚ OSZUSTEM!' : roomData.word}
                                            </h2>
                                            {amIImpostor && (
                                                <p className="impostor-cat-info">
                                                    Kategoria:{' '}
                                                    <span className="text-gold">{roomData.categoryName}</span>
                                                </p>
                                            )}
                                        </>
                                    )}
                                    renderGuestReveal={(guest) => {
                                        const guestIsImpostor = isGuestImpostor(guest.id);
                                        return (
                                            <>
                                                <h2
                                                    className={`impostor-role-title ${guestIsImpostor ? 'text-danger' : 'text-success'}`}
                                                >
                                                    {guestIsImpostor ? 'GOŚĆ JEST OSZUSTEM!' : roomData.word}
                                                </h2>
                                                {guestIsImpostor && (
                                                    <p className="impostor-cat-info">
                                                        Kategoria:{' '}
                                                        <span className="text-gold">{roomData.categoryName}</span>
                                                    </p>
                                                )}
                                            </>
                                        );
                                    }}
                                />
                            ) : (
                                <>
                                    <div
                                        onMouseDown={() => setShowRole(true)}
                                        onMouseUp={() => setShowRole(false)}
                                        onMouseLeave={() => setShowRole(false)}
                                        onTouchStart={() => setShowRole(true)}
                                        onTouchEnd={() => setShowRole(false)}
                                        className={`peek-panel ${showRole ? (amIImpostor ? 'impostor-bg-bad' : 'impostor-bg-good') : 'impostor-bg-hidden'}`}
                                    >
                                        {!showRole ? (
                                            <h3 className="peek-hidden-text">
                                                Kliknij i przytrzymaj, aby zobaczyć rolę
                                            </h3>
                                        ) : (
                                            <>
                                                <h2
                                                    className={`impostor-role-title ${amIImpostor ? 'text-danger' : 'text-success'}`}
                                                >
                                                    {amIImpostor ? 'JESTEŚ OSZUSTEM!' : roomData.word}
                                                </h2>
                                                {amIImpostor && (
                                                    <p className="impostor-cat-info">
                                                        Kategoria:{' '}
                                                        <span className="text-gold">{roomData.categoryName}</span>
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="impostor-secret-warning">Ukryj ekran przed innymi!</p>
                                </>
                            )}
                        </>
                    )}

                    {roomData.phase === 'discussing' && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">Trwa dyskusja!</h2>
                            <p className="impostor-discussing-desc">
                                Ekrany zostały zablokowane. Czas znaleźć oszusta.
                            </p>
                            {!isRoomLocked && !isHost && myLinkedGuests.length > 0 && (
                                <p className="impostor-replay-hint">
                                    Zapomniałeś roli? Poproś hosta o ponowny podgląd.
                                </p>
                            )}
                        </div>
                    )}

                    {!isRoomLocked && roomData.phase === 'discussing' && (
                        <div className="role-replay-bar">
                            {isHost ? (
                                <button type="button" className="btn-role-replay" onClick={replayRoles}>
                                    Pokaż role ponownie (wszyscy)
                                </button>
                            ) : (
                                myLinkedGuests.length > 0 && (
                                    <p className="impostor-replay-hint">
                                        Zapomniałeś roli? Poproś hosta o ponowny podgląd.
                                    </p>
                                )
                            )}
                        </div>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            {roomData.phase === 'peeking' && (
                                <button onClick={startDiscussion} className="btn-impostor-discuss">
                                    Rozpocznij dyskusję (Zablokuj podgląd)
                                </button>
                            )}
                            {canDrawNextWord && (
                                <ConfirmButton
                                    onClick={drawNextWord}
                                    text="Losuj kolejne słowo"
                                />
                            )}
                            <div className="impostor-impostor-count-box">
                                <h3 className="impostor-impostor-count-title">Wyrzuceni Impostorzy</h3>
                                <div className="impostor-impostor-count-row">
                                    <button
                                        type="button"
                                        onClick={() => updateEliminatedImpostors(-1)}
                                        className="btn-impostor-counter"
                                        disabled={(roomData.eliminatedImpostors ?? 0) <= 0}
                                    >
                                        −
                                    </button>
                                    <span className="impostor-impostor-count-value">
                                        {roomData.eliminatedImpostors ?? 0}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => updateEliminatedImpostors(1)}
                                        className="btn-impostor-counter"
                                        disabled={
                                            (roomData.eliminatedImpostors ?? 0) >=
                                            (roomData.totalImpostors ?? impostorIds.length)
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                                <p className="impostor-impostor-count-hint">
                                    Oznaczaj wyrzuconych Impostorów po głosowaniu (łączna liczba jest ukryta).
                                </p>
                            </div>
                            <ConfirmButton onClick={forceResetTable} text="Zakończ rundę i wybierz nową" />
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? 'Zamknij pokój' : 'Wyjdź z pokoju'}
                />
            </div>
        </div>
    );
}

export default Impostor;
