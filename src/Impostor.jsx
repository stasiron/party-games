import { useState, useEffect } from 'react';
import { ref, set, get, onValue } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import ConfirmButton from './ConfirmButton';

function Impostor({ isHost, onLeave, myPlayerId }) {
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [showRole, setShowRole] = useState(false);

    const [roomData, setRoomData] = useState({
        phase: 'lobby', // Fazy: 'lobby', 'peeking', 'discussing'
        word: '',
        impostorId: null,
        categoryName: ''
    });

    useEffect(() => {
        const roomRef = ref(db, 'rooms/impostor/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData(data);
            } else {
                setRoomData({ phase: 'lobby', word: '', impostorId: null, categoryName: '' });
            }
        });
        return () => unsubscribe();
    }, []);

    const startGame = async () => {
        if (!selectedCategory) return;

        const playersRef = ref(db, 'rooms/impostor/players');
        const snapshot = await get(playersRef);
        const playersData = snapshot.val();

        if (!playersData) return;

        const playerIds = Object.keys(playersData);
        const randomImpostorIndex = Math.floor(Math.random() * playerIds.length);
        const chosenImpostorId = playerIds[randomImpostorIndex];

        const words = gameData.impostor.words[selectedCategory];
        const randomWord = words[Math.floor(Math.random() * words.length)];
        const catName = gameData.impostor.categories.find(c => c.id === selectedCategory).name;

        set(ref(db, 'rooms/impostor/gameState'), {
            phase: 'peeking',
            word: randomWord,
            impostorId: chosenImpostorId,
            categoryName: catName
        });
    };

    const startDiscussion = () => {
        set(ref(db, 'rooms/impostor/gameState/phase'), 'discussing');
        setShowRole(false);
    };

    const forceResetTable = () => {
        set(ref(db, 'rooms/impostor/gameState'), {
            phase: 'lobby',
            word: '',
            impostorId: null,
            categoryName: ''
        });
        setSelectedCategory(null);
        setShowRole(false);
    };

    const handleEndGame = () => {
        forceResetTable();
        onLeave();
    };

    const amIImpostor = roomData.impostorId === myPlayerId;

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    {isHost ? (
                        <>
                            <p>Wybierz kategorię dla tej rundy:</p>
                            <div className="games-grid" style={{ marginBottom: '20px' }}>
                                {gameData.impostor.categories.map((cat) => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setSelectedCategory(cat.id)}
                                        style={{
                                            borderColor: selectedCategory === cat.id ? '#d63384' : 'rgba(255,255,255,0.2)',
                                            backgroundColor: selectedCategory === cat.id ? 'rgba(214, 51, 132, 0.2)' : 'rgba(255,255,255,0.05)'
                                        }}
                                    >
                                        <span className="game-title">{cat.name}</span>
                                        <span className="game-desc">{cat.desc}</span>
                                    </button>
                                ))}
                            </div>
                            {selectedCategory && (
                                <button onClick={startGame} style={{ backgroundColor: '#d63384', borderColor: '#d63384', fontWeight: 'bold' }}>
                                    Wylosuj i rozdaj role
                                </button>
                            )}
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze kategorię i wylosuje role...</p>
                    )}
                </div>
            ) : (
                <div>
                    {roomData.phase === 'peeking' && (
                        <>
                            <p style={{ color: '#d63384', fontWeight: 'bold', fontSize: '1.1rem' }}>
                                Faza sprawdzania ról
                            </p>
                            <div
                                onMouseDown={() => setShowRole(true)}
                                onMouseUp={() => setShowRole(false)}
                                onMouseLeave={() => setShowRole(false)}
                                onTouchStart={() => setShowRole(true)}
                                onTouchEnd={() => setShowRole(false)}
                                style={{
                                    padding: '40px 20px',
                                    backgroundColor: showRole ? (amIImpostor ? 'rgba(214, 51, 132, 0.3)' : 'rgba(42, 17, 58, 0.6)') : 'rgba(0,0,0,0.3)',
                                    borderRadius: '16px',
                                    margin: '20px 0',
                                    minHeight: '150px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                }}
                            >
                                {!showRole ? (
                                    <h3 style={{ margin: 0, opacity: 0.5 }}>Kliknij i przytrzymaj, aby zobaczyć rolę</h3>
                                ) : (
                                    <>
                                        <h2 style={{ margin: 0, fontSize: '2rem', color: amIImpostor ? '#ff4444' : '#44ff44' }}>
                                            {amIImpostor ? "JESTEŚ OSZUSTEM!" : roomData.word}
                                        </h2>
                                        {amIImpostor && (
                                            <p style={{ marginTop: '10px', fontSize: '1.2rem', color: '#fff', opacity: 0.9 }}>
                                                Kategoria: <span style={{ fontWeight: 'bold', color: '#ffd700' }}>{roomData.categoryName}</span>
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Ukryj ekran przed innymi!</p>
                        </>
                    )}

                    {roomData.phase === 'discussing' && (
                        <div style={{ padding: '60px 20px', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: '16px', margin: '20px 0', border: '2px solid #d63384' }}>
                            <h2 style={{ margin: 0, color: '#d63384' }}>Trwa dyskusja!</h2>
                            <p style={{ opacity: 0.8, marginTop: '10px' }}>Ekrany zostały zablokowane. Czas znaleźć oszusta.</p>
                        </div>
                    )}

                    {isHost && (
                        <div style={{ marginTop: '30px', display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
                            {roomData.phase === 'peeking' && (
                                <button onClick={startDiscussion} style={{ backgroundColor: '#ffffff', color: '#000', fontWeight: 'bold' }}>
                                    Rozpocznij dyskusję (Zablokuj podgląd)
                                </button>
                            )}
                            <ConfirmButton onClick={forceResetTable} text="Zakończ rundę i wybierz nową" />
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

export default Impostor;