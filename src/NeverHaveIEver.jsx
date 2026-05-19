import { useState, useEffect, useCallback } from 'react';
import { ref, set, onValue } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import ConfirmButton from './ConfirmButton';

function NeverHaveIEver({ isHost, onLeave }) {
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [roomData, setRoomData] = useState({
        isGameStarted: false,
        shuffledQuestions: [],
        currentQuestionIndex: 0
    });

    useEffect(() => {
        const roomRef = ref(db, 'rooms/never-have-i-ever/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData(data);
            } else {
                setRoomData({ isGameStarted: false, shuffledQuestions: [], currentQuestionIndex: 0 });
            }
        });
        return () => unsubscribe();
    }, []);

    // OPTYMALIZACJA: Zapamiętywanie funkcji, by nie obciążać procesora przy re-renderach
    const toggleCategory = useCallback((catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
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
        let allQuestions = [];
        selectedCategories.forEach(catId => {
            allQuestions = [...allQuestions, ...gameData.neverHaveIEver.questions[catId]];
        });

        const shuffled = shuffleArray(allQuestions);

        set(ref(db, 'rooms/never-have-i-ever/gameState'), {
            isGameStarted: true,
            shuffledQuestions: shuffled,
            currentQuestionIndex: 0
        });
    }, [selectedCategories, shuffleArray]);

    // OPTYMALIZACJA: Stabilna referencja dla ConfirmButton (memo zadziała perfekcyjnie)
    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/never-have-i-ever/gameState'), null);
        setSelectedCategories([]);
    }, []);

    const nextQuestion = useCallback(() => {
        if (roomData.currentQuestionIndex < roomData.shuffledQuestions.length - 1) {
            set(ref(db, 'rooms/never-have-i-ever/gameState/currentQuestionIndex'), roomData.currentQuestionIndex + 1);
        }
    }, [roomData.currentQuestionIndex, roomData.shuffledQuestions]);

    const prevQuestion = useCallback(() => {
        if (roomData.currentQuestionIndex > 0) {
            set(ref(db, 'rooms/never-have-i-ever/gameState/currentQuestionIndex'), roomData.currentQuestionIndex - 1);
        }
    }, [roomData.currentQuestionIndex]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    {isHost ? (
                        <>
                            <p>Wybierz kategorie (możesz zaznaczyć kilka):</p>
                            <div className="games-grid nhie-categories-grid">
                                {gameData.neverHaveIEver.categories.map((cat) => {
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
                            {selectedCategories.length > 0 && (
                                <button onClick={startGame} className="btn-nhie-start">
                                    Rozpocznij grę ({selectedCategories.length})
                                </button>
                            )}
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

                    <div className="nhie-question-box">
                        <h3 className="nhie-question-text">
                            {roomData.shuffledQuestions ? roomData.shuffledQuestions[roomData.currentQuestionIndex] : "Ładowanie..."}
                        </h3>
                    </div>

                    {isHost && (
                        <div className="nhie-host-controls">
                            <div className="nhie-nav-buttons">
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

            <div className="nhie-bottom-wrapper">
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? "Zamknij pokój" : "Wyjdź z pokoju"}
                />
            </div>
        </div>
    );
}

export default NeverHaveIEver;