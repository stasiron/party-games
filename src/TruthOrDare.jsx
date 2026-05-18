import { useState, useEffect } from 'react';
import { ref, set, get, onValue, update } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import ConfirmButton from './ConfirmButton';

function TruthOrDare({ isHost, onLeave, playerName }) {
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [isSafeMode, setIsSafeMode] = useState(false);

    const [roomData, setRoomData] = useState({
        isGameStarted: false,
        mode: 'choice',
        currentText: '',
        currentDifficulty: 0,
        currentPlayerName: '',
        truthPool: [],
        darePool: [],
        playerStats: {}
    });

    useEffect(() => {
        const roomRef = ref(db, 'rooms/truth-or-dare/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData(data);
            } else {
                setRoomData({ isGameStarted: false, mode: 'choice', currentText: '', currentDifficulty: 0, currentPlayerName: '', truthPool: [], darePool: [], playerStats: {} });
            }
        });
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

    const getRandomPlayer = async (excludeName) => {
        const playersRef = ref(db, 'rooms/truth-or-dare/players');
        const snapshot = await get(playersRef);
        const data = snapshot.val();
        if (data) {
            let names = Object.values(data).map(p => p.name);
            if (excludeName && names.length > 1) {
                names = names.filter(name => name !== excludeName);
            }
            return names[Math.floor(Math.random() * names.length)];
        }
        return "Gracz";
    };

    const startGame = async () => {
        if (selectedCategories.length === 0) return;

        let allTruths = [];
        let allDares = [];

        selectedCategories.forEach(catId => {
            allTruths = [...allTruths, ...gameData.truthOrDare.content[catId].truth];
            allDares = [...allDares, ...gameData.truthOrDare.content[catId].dare];
        });

        const firstPlayer = await getRandomPlayer(null);

        const playersRef = ref(db, 'rooms/truth-or-dare/players');
        const snapshot = await get(playersRef);
        const data = snapshot.val();
        let initialStats = {};
        if (data) {
            Object.values(data).forEach(p => {
                initialStats[p.name] = { totalLevel: 0, count: 0 };
            });
        }

        set(ref(db, 'rooms/truth-or-dare/gameState'), {
            isGameStarted: true,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: firstPlayer,
            truthPool: shuffleArray(allTruths),
            darePool: shuffleArray(allDares),
            playerStats: initialStats
        });
    };

    const drawContent = (type) => {
        const poolKey = type === 'truth' ? 'truthPool' : 'darePool';
        const currentPool = roomData[poolKey] || [];

        if (currentPool.length === 0) {
            update(ref(db, 'rooms/truth-or-dare/gameState'), {
                mode: type,
                currentText: type === 'truth' ? "Koniec pytań w tej puli! Musisz wybrać Wyzwanie." : "Koniec wyzwań w tej puli! Musisz wybrać Prawdę.",
                currentDifficulty: 0
            });
            return;
        }

        let availableOptions = [...currentPool];

        if (isSafeMode) {
            availableOptions = availableOptions.filter(q => q.level <= 3);
            if (availableOptions.length === 0) {
                update(ref(db, 'rooms/truth-or-dare/gameState'), {
                    mode: type,
                    currentText: type === 'truth' ? "Brak bezpiecznych pytań! Musisz wybrać Wyzwanie." : "Brak bezpiecznych wyzwań! Musisz wybrać Prawdę.",
                    currentDifficulty: 0
                });
                return;
            }
        } else {
            const stats = roomData.playerStats || {};
            const myStats = stats[roomData.currentPlayerName] || { totalLevel: 0, count: 0 };
            let roomTotalLevel = 0, roomTotalCount = 0;

            Object.values(stats).forEach(s => {
                roomTotalLevel += s.totalLevel;
                roomTotalCount += s.count;
            });

            const roomAvg = roomTotalCount > 0 ? roomTotalLevel / roomTotalCount : 0;
            const myAvg = myStats.count > 0 ? myStats.totalLevel / myStats.count : 0;

            if (myAvg < roomAvg) {
                const harderOptions = availableOptions.filter(q => q.level >= Math.floor(roomAvg));
                if (harderOptions.length > 0) availableOptions = harderOptions;
            }
        }

        const selectedItem = availableOptions[0];
        const indexToRemove = currentPool.findIndex(q => q.text === selectedItem.text);
        const newPool = [...currentPool];
        if (indexToRemove !== -1) newPool.splice(indexToRemove, 1);

        const stats = roomData.playerStats || {};
        const myStats = stats[roomData.currentPlayerName] || { totalLevel: 0, count: 0 };
        const newStats = {
            ...stats,
            [roomData.currentPlayerName]: {
                totalLevel: myStats.totalLevel + selectedItem.level,
                count: myStats.count + 1
            }
        };

        update(ref(db, 'rooms/truth-or-dare/gameState'), {
            mode: type,
            currentText: selectedItem.text,
            currentDifficulty: selectedItem.level,
            [poolKey]: newPool,
            playerStats: newStats
        });
    };

    const nextTurn = async () => {
        const nextPlayer = await getRandomPlayer(roomData.currentPlayerName);
        update(ref(db, 'rooms/truth-or-dare/gameState'), {
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: nextPlayer
        });
    };

    const forceResetTable = () => {
        set(ref(db, 'rooms/truth-or-dare/gameState'), null);
        setSelectedCategories([]);
        setIsSafeMode(false);
    };

    const handleEndGame = () => {
        forceResetTable();
        onLeave();
    };

    const amICurrentPlayer = roomData.currentPlayerName === playerName;
    const cardStateClass = amICurrentPlayer ? 'tod-card-active' : 'tod-card-disabled';

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    {isHost ? (
                        <>
                            <p>Wybierz kategorie (możesz zaznaczyć kilka):</p>
                            <div className="games-grid" style={{ marginBottom: '20px' }}>
                                {gameData.truthOrDare.categories.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id)}
                                            className={isSelected ? 'selected-category' : 'unselected-category'}
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
                                <button onClick={startGame} className="btn-main-action">
                                    Rozpocznij grę ({selectedCategories.length})
                                </button>
                            )}
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze talię i wystartuje stół...</p>
                    )}
                </div>
            ) : (
                <div>
                    <div className="turn-header">
                        <h2
                            onDoubleClick={() => setIsSafeMode(prev => !prev)}
                            style={{ margin: 0, fontSize: '1.2rem', opacity: 0.8, cursor: 'default', userSelect: 'none' }}
                        >
                            Kolej gracza:
                            {isSafeMode && <span style={{ opacity: 0.2, fontSize: '1rem', marginLeft: '5px' }}>●</span>}
                        </h2>
                        <h1 style={{ margin: '5px 0', fontSize: '2.5rem', color: amICurrentPlayer ? '#44ff44' : '#d63384', textTransform: 'uppercase' }}>
                            {roomData.currentPlayerName}
                            {amICurrentPlayer && " (TO TY!)"}
                        </h1>
                    </div>

                    {roomData.mode === 'choice' ? (
                        <>
                            <p style={{ opacity: amICurrentPlayer ? 1 : 0.6, fontWeight: amICurrentPlayer ? 'bold' : 'normal', marginBottom: '20px' }}>
                                {amICurrentPlayer ? "Podejmij decyzję:" : "Czekamy na wybór gracza..."}
                            </p>
                            <div className="cards-container">
                                <div
                                    className={`tod-card tod-truth ${cardStateClass}`}
                                    onClick={() => amICurrentPlayer && drawContent('truth')}
                                >
                                    <h2 style={{ margin: 0 }} className="text-truth">PRAWDA</h2>
                                </div>

                                <div
                                    className={`tod-card tod-dare ${cardStateClass}`}
                                    onClick={() => amICurrentPlayer && drawContent('dare')}
                                >
                                    <h2 style={{ margin: 0 }} className="text-dare">WYZWANIE</h2>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className={`tod-result-box ${roomData.mode === 'truth' ? 'tod-truth' : 'tod-dare'}`}>
                            {roomData.currentDifficulty > 0 && (
                                <div style={{ position: 'absolute', top: '15px', right: '20px', fontSize: '1rem', opacity: 0.8, color: '#ffd700' }}>
                                    {'★'.repeat(roomData.currentDifficulty)}
                                    <span style={{ opacity: 0.3 }}>{'★'.repeat(5 - roomData.currentDifficulty)}</span>
                                </div>
                            )}

                            <span style={{ fontSize: '1rem', opacity: 0.7, marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '2px' }} className={roomData.mode === 'truth' ? 'text-truth' : 'text-dare'}>
                                {roomData.mode === 'truth' ? 'Prawda' : 'Wyzwanie'}
                            </span>

                            <h3 style={{ margin: 0, fontSize: '1.5rem', lineHeight: '1.4' }}>
                                {roomData.currentText}
                            </h3>

                            {roomData.currentDifficulty === 0 && amICurrentPlayer && (
                                <button
                                    onClick={() => drawContent(roomData.mode === 'truth' ? 'dare' : 'truth')}
                                    className={`btn-emergency ${roomData.mode === 'truth' ? 'bg-dare' : 'bg-truth'}`}
                                >
                                    Zmień na {roomData.mode === 'truth' ? 'Wyzwanie' : 'Prawdę'}
                                </button>
                            )}
                        </div>
                    )}

                    {isHost && (
                        <div className="host-controls">
                            {roomData.mode !== 'choice' && (
                                <button onClick={nextTurn} className="btn-main-action">
                                    Zakończ kolejkę i losuj gracza
                                </button>
                            )}
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

export default TruthOrDare;