import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { set } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.js';
import { getNeverHaveIEverCategories } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { shuffleArray } from '../../lib/shuffle';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';
import { useCategorySelection } from '../../lib/useCategorySelection';

function NeverHaveIEver({ isHost, onLeave, roomInviteUrl, roomId }) {
    const playableCategories = useMemo(
        () => getNeverHaveIEverCategories(gameData.neverHaveIEver),
        []
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);
    const defaultRoomState = useMemo(
        () => ({ isGameStarted: false, shuffledQuestions: [], currentQuestionIndex: 0 }),
        []
    );
    const roomData = useRoomGameState(roomId, defaultRoomState);
    usePiGameSession(roomData.isGameStarted);

    const startGame = useCallback(() => {
        const allQuestions = [];
        selectedCategories.forEach((catId) => {
            const pool = gameData.neverHaveIEver.questions[catId];
            if (Array.isArray(pool)) {
                allQuestions.push(...pool);
            }
        });

        const shuffled = shuffleArray(allQuestions);

        set(ref(db, `rooms/${roomId}/gameState`), {
            isGameStarted: true,
            shuffledQuestions: shuffled,
            currentQuestionIndex: 0
        });
    }, [selectedCategories, roomId]);

    // OPTYMALIZACJA: Stabilna referencja dla ConfirmButton (memo zadziała perfekcyjnie)
    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        resetCategoriesToAll();
    }, [roomId, resetCategoriesToAll]);

    const nextQuestion = useCallback(() => {
        if (roomData.currentQuestionIndex < roomData.shuffledQuestions.length - 1) {
            set(ref(db, `rooms/${roomId}/gameState/currentQuestionIndex`), roomData.currentQuestionIndex + 1);
        }
    }, [roomData.currentQuestionIndex, roomData.shuffledQuestions, roomId]);

    const prevQuestion = useCallback(() => {
        if (roomData.currentQuestionIndex > 0) {
            set(ref(db, `rooms/${roomId}/gameState/currentQuestionIndex`), roomData.currentQuestionIndex - 1);
        }
    }, [roomData.currentQuestionIndex, roomId]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title="🙅 Nigdy w życiu">
                        <ol className="game-rules__list">
                            <li>Host wybiera kategorie i czyta na głos kolejne stwierdzenie „Nigdy w życiu nie…”.</li>
                            <li>Gracze, którzy to zrobili, podnoszą palec (lub piją łyk — ustalcie zasady na stole).</li>
                            <li>Można krótko skomentować historię, potem Host przechodzi do następnego pytania.</li>
                            <li>Bez osądzania — chodzi o zabawę i poznanie się nawzajem.</li>
                        </ol>
                    </GameRules>

                    {isHost ? (
                        <>
                            <p>Wybierz kategorie (możesz zaznaczyć kilka):</p>
                            <div className="games-grid categories-grid">
                                {playableCategories.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id)}
                                            className={isSelected ? 'category-btn-selected' : 'category-btn-unselected'}
                                        >
                                            <span className="game-title">{cat.name}</span>
                                            <span className="game-desc">{cat.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="lobby-start-actions actions-stack">
                                <button
                                    type="button"
                                    onClick={startGame}
                                    className="btn-accent btn-lobby-start"
                                    disabled={selectedCategories.length === 0}
                                >
                                    Rozpocznij grę ({selectedCategories.length})
                                </button>
                            </div>
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze kategorie i wystartuje grę...</p>
                    )}
                </div>
            ) : (
                <div>
                    <p className="nhie-progress-text">
                        Pytanie {roomData.currentQuestionIndex + 1} z {roomData.shuffledQuestions ? roomData.shuffledQuestions.length : 0}
                    </p>

                    <div className="content-panel content-panel--dark">
                        <h3 className="nhie-question-text">
                            {roomData.shuffledQuestions ? roomData.shuffledQuestions[roomData.currentQuestionIndex] : "Ładowanie..."}
                        </h3>
                    </div>

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row nhie-nav-buttons">
                                <button
                                    onClick={prevQuestion}
                                    disabled={roomData.currentQuestionIndex === 0}
                                    className={`btn-nhie-prev ${roomData.currentQuestionIndex === 0 ? 'disabled' : ''}`}
                                >
                                    Cofnij
                                </button>
                                <button
                                    onClick={nextQuestion}
                                    disabled={roomData.shuffledQuestions && roomData.currentQuestionIndex === roomData.shuffledQuestions.length - 1}
                                    className="btn-nhie-next"
                                >
                                    {(roomData.shuffledQuestions && roomData.currentQuestionIndex === roomData.shuffledQuestions.length - 1) ? 'Koniec pytań' : 'Następne'}
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
                    text={isHost ? "Zamknij pokój" : "Wyjdź z pokoju"}
                />
            </div>
        </div>
    );
}

export default NeverHaveIEver;