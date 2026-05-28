import { useState, useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { set } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.js';
import { getDarkStoriesDifficulties } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { shuffleArray } from '../../lib/shuffle';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';

function DarkStories({ isHost, onLeave, roomInviteUrl, roomId }) {
    const playableDifficulties = useMemo(
        () => getDarkStoriesDifficulties(gameData.darkStories),
        []
    );

    const [selectedDifficulties, setSelectedDifficulties] = useState([]);
    const defaultRoomState = useMemo(
        () => ({
            isGameStarted: false,
            shuffledStories: [],
            currentStoryIndex: 0,
            solutionRevealed: false,
        }),
        []
    );
    const roomData = useRoomGameState(roomId, defaultRoomState, { mergeDefaults: true });
    usePiGameSession(roomData.isGameStarted);

    const toggleDifficulty = useCallback((diffId) => {
        setSelectedDifficulties((prev) =>
            prev.includes(diffId) ? prev.filter((id) => id !== diffId) : [...prev, diffId]
        );
    }, []);

    const startGame = useCallback(() => {
        const allStories = [];
        selectedDifficulties.forEach((diffId) => {
            const pool = gameData.darkStories.stories[diffId];
            if (Array.isArray(pool)) {
                allStories.push(...pool);
            }
        });

        const shuffled = shuffleArray(allStories);

        set(ref(db, `rooms/${roomId}/gameState`), {
            isGameStarted: true,
            shuffledStories: shuffled,
            currentStoryIndex: 0,
            solutionRevealed: false,
        });
    }, [selectedDifficulties, roomId]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        setSelectedDifficulties([]);
    }, [roomId]);

    const currentStory = roomData.shuffledStories?.[roomData.currentStoryIndex];

    const navigateToStory = useCallback(
        (index) => {
            if (!roomData.shuffledStories?.length) return;
            set(ref(db, `rooms/${roomId}/gameState`), {
                isGameStarted: true,
                shuffledStories: roomData.shuffledStories,
                currentStoryIndex: index,
                solutionRevealed: false,
            });
        },
        [roomData.shuffledStories, roomId]
    );

    const nextStory = useCallback(() => {
        if (roomData.currentStoryIndex < roomData.shuffledStories.length - 1) {
            navigateToStory(roomData.currentStoryIndex + 1);
        }
    }, [roomData.currentStoryIndex, roomData.shuffledStories, navigateToStory]);

    const prevStory = useCallback(() => {
        if (roomData.currentStoryIndex > 0) {
            navigateToStory(roomData.currentStoryIndex - 1);
        }
    }, [roomData.currentStoryIndex, navigateToStory]);

    const toggleSolutionRevealed = useCallback(() => {
        set(
            ref(db, `rooms/${roomId}/gameState/solutionRevealed`),
            !roomData.solutionRevealed
        );
    }, [roomData.solutionRevealed, roomId]);

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
                    <GameRules title="🕯️ Czarne historie">
                        <ol className="game-rules__list">
                            <li>
                                <strong>Host jest narratorem</strong> — zna pełne rozwiązanie każdej
                                historii (widzi je tylko na swoim ekranie).
                            </li>
                            <li>
                                Narrator czyta na głos <strong>zagadkę</strong> (scenariusz bez
                                wyjaśnienia). Pozostali gracze odkrywają ją pytaniami.
                            </li>
                            <li>
                                Gracze zadają pytania, na które narrator odpowiada wyłącznie:{' '}
                                <strong>Tak</strong>, <strong>Nie</strong> lub{' '}
                                <strong>Nieistotne</strong>.
                            </li>
                            <li>
                                Gdy ktoś uważa, że rozwiązał zagadkę, opowiada teorię. Narrator
                                potwierdza, czy jest blisko, czy trafił w punkt.
                            </li>
                            <li>
                                Po rozwiązaniu narrator może <strong>odsłonić rozwiązanie</strong> dla
                                wszystkich, potem przechodzi do następnej historii (odsłonięcie się resetuje).
                            </li>
                        </ol>
                    </GameRules>

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
                                <div className="actions-stack">
                                    <button
                                        type="button"
                                        onClick={startGame}
                                        className="btn-accent"
                                    >
                                        Rozpocznij grę ({selectedDifficulties.length})
                                    </button>
                                </div>
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
                            <div className="game-nav-row ds-nav-buttons">
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
