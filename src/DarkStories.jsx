import { useState, useEffect, useCallback, useMemo } from 'react';
import { ref, set, onValue, update } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import { getDarkStoriesDifficulties } from './gameContentUtils';
import ConfirmButton from './ConfirmButton';
import RoomInviteQR from './RoomInviteQR';

function DarkStories({ isHost, onLeave, roomInviteUrl }) {
    const playableDifficulties = useMemo(
        () => getDarkStoriesDifficulties(gameData.darkStories),
        []
    );

    const [selectedDifficulties, setSelectedDifficulties] = useState([]);
    const [roomData, setRoomData] = useState({
        isGameStarted: false,
        shuffledStories: [],
        currentStoryIndex: 0,
        solutionRevealed: false,
    });

    useEffect(() => {
        const roomRef = ref(db, 'rooms/dark-stories/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData({
                    isGameStarted: false,
                    shuffledStories: [],
                    currentStoryIndex: 0,
                    solutionRevealed: false,
                    ...data,
                });
            } else {
                setRoomData({
                    isGameStarted: false,
                    shuffledStories: [],
                    currentStoryIndex: 0,
                    solutionRevealed: false,
                });
            }
        });
        return () => unsubscribe();
    }, []);

    const toggleDifficulty = useCallback((diffId) => {
        setSelectedDifficulties((prev) =>
            prev.includes(diffId) ? prev.filter((id) => id !== diffId) : [...prev, diffId]
        );
    }, []);

    const shuffleArray = useCallback((array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }, []);

    const startGame = useCallback(() => {
        let allStories = [];
        selectedDifficulties.forEach((diffId) => {
            const pool = gameData.darkStories.stories[diffId];
            if (Array.isArray(pool)) {
                allStories = [...allStories, ...pool];
            }
        });

        const shuffled = shuffleArray(allStories);

        set(ref(db, 'rooms/dark-stories/gameState'), {
            isGameStarted: true,
            shuffledStories: shuffled,
            currentStoryIndex: 0,
            solutionRevealed: false,
        });
    }, [selectedDifficulties, shuffleArray]);

    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/dark-stories/gameState'), null);
        setSelectedDifficulties([]);
    }, []);

    const currentStory = roomData.shuffledStories?.[roomData.currentStoryIndex];

    const goToStory = useCallback(
        (index) => {
            update(ref(db, 'rooms/dark-stories/gameState'), {
                currentStoryIndex: index,
                solutionRevealed: false,
            });
        },
        []
    );

    const nextStory = useCallback(() => {
        if (roomData.currentStoryIndex < roomData.shuffledStories.length - 1) {
            goToStory(roomData.currentStoryIndex + 1);
        }
    }, [roomData.currentStoryIndex, roomData.shuffledStories, goToStory]);

    const prevStory = useCallback(() => {
        if (roomData.currentStoryIndex > 0) {
            goToStory(roomData.currentStoryIndex - 1);
        }
    }, [roomData.currentStoryIndex, goToStory]);

    const toggleSolutionRevealed = useCallback(() => {
        set(
            ref(db, 'rooms/dark-stories/gameState/solutionRevealed'),
            !roomData.solutionRevealed
        );
    }, [roomData.solutionRevealed]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const isLastStory =
        roomData.shuffledStories &&
        roomData.currentStoryIndex === roomData.shuffledStories.length - 1;

    return (
        <div className="dark-stories">
            {!roomData.isGameStarted ? (
                <div>
                    <div className="ds-rules-panel content-panel content-panel--dark">
                        <h3 className="ds-rules-title">Zasady — Czarne historie</h3>
                        <ol className="ds-rules-list">
                            <li>
                                <strong>Host jest narratorem</strong> — zna pełne rozwiązanie każdej
                                historii (widzi je tylko na swoim ekranie).
                            </li>
                            <li>
                                Narrator czyta na głos <strong>zagadkę</strong> (scenariusz bez
                                wyjaśnienia). Pozostali gracze jej nie znają z góry — odkrywają ją
                                pytaniami.
                            </li>
                            <li>
                                Gracze zadają pytania, na które narrator odpowiada wyłącznie:{' '}
                                <strong>Tak</strong>, <strong>Nie</strong> lub{' '}
                                <strong>Nieistotne</strong>.
                            </li>
                            <li>
                                Gdy ktoś uważa, że rozwiązał zagadkę, opowiada swoją teorię.
                                Narrator potwierdza, czy jest blisko, czy trafił w punkt.
                            </li>
                            <li>
                                Po rozwiązaniu narrator może <strong>odsłonić rozwiązanie</strong> dla
                                wszystkich i przejść do następnej historii.
                            </li>
                        </ol>
                    </div>

                    {isHost ? (
                        <>
                            <p>Wybierz poziom trudności (możesz zaznaczyć kilka):</p>
                            <div className="games-grid categories-grid">
                                {playableDifficulties.map((diff) => {
                                    const isSelected = selectedDifficulties.includes(diff.id);
                                    return (
                                        <button
                                            key={diff.id}
                                            type="button"
                                            onClick={() => toggleDifficulty(diff.id)}
                                            className={
                                                isSelected
                                                    ? 'category-btn-selected'
                                                    : 'category-btn-unselected'
                                            }
                                        >
                                            <span className="game-title">{diff.name}</span>
                                            <span className="game-desc">{diff.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedDifficulties.length > 0 && (
                                <button
                                    type="button"
                                    onClick={startGame}
                                    className="btn-accent"
                                >
                                    Rozpocznij grę ({selectedDifficulties.length})
                                </button>
                            )}
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </>
                    ) : (
                        <p>
                            Czekamy aż Host (narrator) wybierze poziom trudności i wystartuje grę…
                        </p>
                    )}
                </div>
            ) : (
                <div>
                    <p className="ds-progress-text">
                        Historia {roomData.currentStoryIndex + 1} z{' '}
                        {roomData.shuffledStories?.length ?? 0}
                    </p>

                    <div className="content-panel content-panel--dark">
                        <p className="ds-prompt-label">Zagadka</p>
                        <h3 className="ds-prompt-text">
                            {currentStory?.prompt ?? 'Ładowanie…'}
                        </h3>
                    </div>

                    {isHost && currentStory?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--host">
                            <p className="ds-prompt-label">Rozwiązanie (tylko narrator)</p>
                            <p className="ds-solution-text">{currentStory.solution}</p>
                            <button
                                type="button"
                                onClick={toggleSolutionRevealed}
                                className="btn-ds-reveal"
                            >
                                {roomData.solutionRevealed
                                    ? 'Ukryj rozwiązanie przed grupą'
                                    : 'Odsłoń rozwiązanie dla wszystkich'}
                            </button>
                        </div>
                    )}

                    {!isHost && roomData.solutionRevealed && currentStory?.solution && (
                        <div className="content-panel ds-solution-panel ds-solution-panel--revealed">
                            <p className="ds-prompt-label">Rozwiązanie</p>
                            <p className="ds-solution-text">{currentStory.solution}</p>
                        </div>
                    )}

                    {!isHost && !roomData.solutionRevealed && (
                        <p className="ds-player-hint">
                            Zadawaj pytania Tak / Nie / Nieistotne. Narrator zna odpowiedź.
                        </p>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="ds-nav-buttons">
                                <button
                                    type="button"
                                    onClick={prevStory}
                                    disabled={roomData.currentStoryIndex === 0}
                                    className={`btn-ds-prev ${
                                        roomData.currentStoryIndex === 0 ? 'disabled' : ''
                                    }`}
                                >
                                    Cofnij
                                </button>
                                <button
                                    type="button"
                                    onClick={nextStory}
                                    disabled={isLastStory}
                                    className="btn-ds-next"
                                >
                                    {isLastStory ? 'Koniec historii' : 'Następna historia'}
                                </button>
                            </div>
                            <ConfirmButton onClick={forceResetTable} text="Zresetuj stół" />
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

export default DarkStories;
