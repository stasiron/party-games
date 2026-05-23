import { useState, useCallback, useMemo, useEffect } from 'react';
import { ref } from 'firebase/database';
import { set, get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.json';
import { getImpostorCategories, getCategoryLabel } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { useRoomSettings } from '../../lib/useRoomSettings';
import {
    getImpostorWeights,
    pickWeightedWithoutReplacement,
    buildUpdatedRoleHistory
} from '../../lib/roleFairness';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';
import { usePiGameSession } from '../../lib/usePiGameSession';

const DEFAULT_SETTINGS = { fairnessEnabled: false };

function Impostor({ isHost, onLeave, myPlayerId, tablePlayers = [], roomInviteUrl }) {
    const playableCategories = useMemo(
        () => getImpostorCategories(gameData.impostor),
        []
    );

    const lobbyPlayerCount = useMemo(
        () => tablePlayers.filter((p) => p.isOnline !== false).length,
        [tablePlayers]
    );

    const maxImpostors = Math.max(1, lobbyPlayerCount - 1);

    const [selectedCategories, setSelectedCategories] = useState([]);
    const [impostorCount, setImpostorCount] = useState(1);
    const [showRole, setShowRole] = useState(false);

    useEffect(() => {
        if (impostorCount <= maxImpostors) return undefined;
        const t = setTimeout(() => setImpostorCount(Math.max(1, maxImpostors)), 0);
        return () => clearTimeout(t);
    }, [impostorCount, maxImpostors]);

    const roomSettings = useRoomSettings('impostor', DEFAULT_SETTINGS);

    const defaultRoomState = useMemo(
        () => ({
            phase: 'lobby',
            word: '',
            impostorIds: [],
            categoryName: '',
            startingPlayerId: null,
            categoryIds: []
        }),
        []
    );
    const roomData = useRoomGameState('impostor', defaultRoomState, { mergeDefaults: true });

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
            setImpostorCount((prev) => {
                const next = prev + delta;
                if (next < 1) return 1;
                if (next > maxImpostors) return maxImpostors;
                return next;
            });
        },
        [maxImpostors]
    );

    const toggleFairness = useCallback(() => {
        set(ref(db, 'rooms/impostor/settings/fairnessEnabled'), !roomSettings.fairnessEnabled);
    }, [roomSettings.fairnessEnabled]);

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;

        const playersRef = ref(db, 'rooms/impostor/players');
        const snapshot = await get(playersRef);
        const playersData = snapshot.val();

        if (!playersData) return;

        const playerIds = Object.keys(playersData);
        if (playerIds.length < 2) return;

        const effectiveImpostorCount = Math.min(impostorCount, playerIds.length - 1);

        const historySnap = await get(ref(db, 'rooms/impostor/roleHistory'));
        const roleHistory = historySnap.val();

        const weights = getImpostorWeights(playerIds, roleHistory, roomSettings.fairnessEnabled);
        const chosenImpostorIds = pickWeightedWithoutReplacement(
            playerIds,
            effectiveImpostorCount,
            weights
        );

        const startingPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];

        const chosenCatId =
            selectedCategories[Math.floor(Math.random() * selectedCategories.length)];
        const wordsForCat = gameData.impostor.words[chosenCatId] ?? [];
        if (wordsForCat.length === 0) return;

        const randomWord = wordsForCat[Math.floor(Math.random() * wordsForCat.length)];
        const catNameDisplay = getCategoryLabel(playableCategories, chosenCatId);

        const updatedHistory = buildUpdatedRoleHistory(roleHistory, chosenImpostorIds, playerIds);

        await Promise.all([
            set(ref(db, 'rooms/impostor/roleHistory'), updatedHistory),
            set(ref(db, 'rooms/impostor/gameState'), {
                phase: 'peeking',
                word: randomWord,
                impostorIds: chosenImpostorIds,
                categoryName: catNameDisplay,
                startingPlayerId,
                categoryIds: selectedCategories
            })
        ]);
    }, [selectedCategories, playableCategories, impostorCount, roomSettings.fairnessEnabled]);

    const drawNextWord = useCallback(async () => {
        const categoryIds =
            Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
                ? roomData.categoryIds
                : selectedCategories;

        if (categoryIds.length === 0) return;

        let chosenCatId = categoryIds[0];
        let randomWord = roomData.word;

        for (let attempt = 0; attempt < 25; attempt++) {
            chosenCatId = categoryIds[Math.floor(Math.random() * categoryIds.length)];
            const wordsForCat = gameData.impostor.words[chosenCatId] ?? [];
            if (wordsForCat.length === 0) return;
            randomWord = wordsForCat[Math.floor(Math.random() * wordsForCat.length)];
            if (randomWord !== roomData.word || wordsForCat.length === 1) break;
        }

        const catNameDisplay = getCategoryLabel(playableCategories, chosenCatId);

        await update(ref(db, 'rooms/impostor/gameState'), {
            word: randomWord,
            categoryName: catNameDisplay,
            phase: 'peeking'
        });
        setShowRole(false);
    }, [roomData.categoryIds, roomData.word, selectedCategories, playableCategories]);

    const canDrawNextWord =
        (Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0) ||
        selectedCategories.length > 0;

    const startDiscussion = useCallback(() => {
        set(ref(db, 'rooms/impostor/gameState/phase'), 'discussing');
        setShowRole(false);
    }, []);

    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/impostor/gameState'), {
            phase: 'lobby',
            word: '',
            impostorIds: [],
            categoryName: '',
            startingPlayerId: null,
            categoryIds: []
        });
        setSelectedCategories([]);
        setShowRole(false);
    }, []);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const amIImpostor = impostorIds.includes(myPlayerId);

    const startingPlayerName = useMemo(() => {
        if (!roomData.startingPlayerId) return null;
        const player = tablePlayers.find((p) => p.id === roomData.startingPlayerId);
        return player?.name ?? 'Nieznany gracz';
    }, [roomData.startingPlayerId, tablePlayers]);

    const canStart =
        selectedCategories.length > 0 && lobbyPlayerCount >= 2 && impostorCount <= maxImpostors;

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    <GameRules title="Impostor">
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
                                <div className="impostor-impostor-count-row">
                                    <button
                                        type="button"
                                        onClick={() => changeImpostorCount(-1)}
                                        className="btn-impostor-counter"
                                        disabled={impostorCount <= 1}
                                    >
                                        −
                                    </button>
                                    <span className="impostor-impostor-count-value">{impostorCount}</span>
                                    <button
                                        type="button"
                                        onClick={() => changeImpostorCount(1)}
                                        className="btn-impostor-counter"
                                        disabled={impostorCount >= maxImpostors}
                                    >
                                        +
                                    </button>
                                </div>
                                <p className="impostor-impostor-count-hint">
                                    Graczy przy stole: {lobbyPlayerCount} (max {maxImpostors} Impostorów)
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
                    {startingPlayerName && (
                        <p className="impostor-starting-player">
                            Zaczyna: <strong>{startingPlayerName}</strong>
                        </p>
                    )}

                    {roomData.phase === 'peeking' && (
                        <>
                            <p className="impostor-peeking-header">Faza sprawdzania ról</p>
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

                    {roomData.phase === 'discussing' && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">Trwa dyskusja!</h2>
                            <p className="impostor-discussing-desc">
                                Ekrany zostały zablokowane. Czas znaleźć oszusta.
                            </p>
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
