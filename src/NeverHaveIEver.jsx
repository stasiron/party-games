import { useState, useEffect } from 'react';
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
        // Optymalizacja: Prawidłowe zamykanie nasłuchu
        return () => unsubscribe();
    }, []);

    const toggleCategory = (catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    };

    const shuffleArray = (array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    };

    const startGame = () => {
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
    };

    const forceResetTable = () => {
        set(ref(db, 'rooms/never-have-i-ever/gameState'), null);
        setSelectedCategories([]);
    };

    // Optymalizacja: Wysyłamy tylko zmianę numeru indeksu (oszczędność transferu i bazy)
    const nextQuestion = () => {
        if (roomData.currentQuestionIndex < roomData.shuffledQuestions.length - 1) {
            set(ref(db, 'rooms/never-have-i-ever/gameState/currentQuestionIndex'), roomData.currentQuestionIndex + 1);
        }
    };

    const prevQuestion = () => {
        if (roomData.currentQuestionIndex > 0) {
            set(ref(db, 'rooms/never-have-i-ever/gameState/currentQuestionIndex'), roomData.currentQuestionIndex - 1);
        }
    };

    const handleEndGame = () => {
        forceResetTable();
        onLeave();
    };

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    {isHost ? (
                        <>
                            <p>Wybierz kategorie (możesz zaznaczyć kilka):</p>
                            <div className="games-grid" style={{ marginBottom: '20px' }}>
                                {gameData.neverHaveIEver.categories.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id)}
                                            style={{
                                                borderColor: isSelected ? '#d63384' : 'rgba(255,255,255,0.2)',
                                                backgroundColor: isSelected ? 'rgba(214, 51, 132, 0.2)' : 'rgba(255,255,255,0.05)'
                                            }}
                                        >
                                            <span className="game-title">{cat.name}</span>
                                            <span className="game-desc">{cat.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedCategories.length > 0 && (
                                <button onClick={startGame} style={{ backgroundColor: '#d63384', borderColor: '#d63384', fontWeight: 'bold' }}>
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
                    <p style={{ color: '#d63384', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        Pytanie {roomData.currentQuestionIndex + 1} z {roomData.shuffledQuestions ? roomData.shuffledQuestions.length : 0}
                    </p>

                    <div style={{ padding: '40px 20px', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '16px', margin: '20px 0', minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '1.5rem', lineHeight: '1.4' }}>
                            {roomData.shuffledQuestions ? roomData.shuffledQuestions[roomData.currentQuestionIndex] : "Ładowanie..."}
                        </h3>
                    </div>

                    {isHost && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                    onClick={prevQuestion}
                                    disabled={roomData.currentQuestionIndex === 0}
                                    style={{ backgroundColor: 'transparent', width: 'auto', padding: '15px 20px', opacity: roomData.currentQuestionIndex === 0 ? 0.3 : 1 }}
                                >
                                    Cofnij
                                </button>
                                <button
                                    onClick={nextQuestion}
                                    disabled={roomData.shuffledQuestions && roomData.currentQuestionIndex === roomData.shuffledQuestions.length - 1}
                                    style={{ backgroundColor: '#ffffff', color: '#000', fontWeight: 'bold' }}
                                >
                                    {(roomData.shuffledQuestions && roomData.currentQuestionIndex === roomData.shuffledQuestions.length - 1) ? 'Koniec pytań' : 'Następne'}
                                </button>
                            </div>
                            <ConfirmButton onClick={forceResetTable} text="Zresetuj stół" />
                        </div>
                    )}
                </div>
            )}

            <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'center' }}>
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? "Zamknij pokój" : "Wyjdź z pokoju"}
                />
            </div>
        </div>
    );
}

export default NeverHaveIEver;