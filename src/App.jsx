import { useState, useEffect } from 'react';
import { ref, set, push, remove, onValue, onDisconnect, get } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import NeverHaveIEver from './NeverHaveIEver';
import Impostor from './Impostor';
import TruthOrDare from './TruthOrDare';
import Mafia from './Mafia';
import './App.css';

function App() {
    const [selectedGame, setSelectedGame] = useState(null);
    const [playerName, setPlayerName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [nameError, setNameError] = useState('');

    const [playersList, setPlayersList] = useState([]);
    const [myPlayerId, setMyPlayerId] = useState(null);
    const [hostExists, setHostExists] = useState(false);

    const [hostLost, setHostLost] = useState(false);
    const [migrationCountdown, setMigrationCountdown] = useState(null);

    // 1. NASŁUCHIWANIE GRACZY I STATUSÓW
    useEffect(() => {
        if (!selectedGame) return;

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const unsubscribe = onValue(playersRef, (snapshot) => {
            const data = snapshot.val() || {};

            const playersArray = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));
            setPlayersList(playersArray);

            const activeHost = playersArray.find(player => player.isHost === true && player.isOnline !== false);
            setHostExists(!!activeHost);

            if (isJoined && myPlayerId) {
                if (!data[myPlayerId]) {
                    const myRef = ref(db, `rooms/${selectedGame}/players/${myPlayerId}`);
                    set(myRef, { name: playerName, isHost: isHost, isOnline: true });
                    onDisconnect(myRef).update({ isOnline: false });
                } else {
                    if (data[myPlayerId].isOnline === false) {
                        set(ref(db, `rooms/${selectedGame}/players/${myPlayerId}/isOnline`), true);
                    }
                    setIsHost(data[myPlayerId].isHost || false);

                    if (!activeHost) {
                        setHostLost(true);
                    } else {
                        setHostLost(false);
                    }
                }
            } else {
                setHostLost(false);
            }
        });

        return () => unsubscribe();
    }, [selectedGame, isJoined, myPlayerId, playerName]);

    // 2. STOPER I MIGRACJA HOSTA
    useEffect(() => {
        let timer;

        const triggerMigration = async () => {
            const snapshot = await get(ref(db, `rooms/${selectedGame}/players`));
            const data = snapshot.val();
            if (data) {
                const hasActiveHostNow = Object.values(data).some(p => p.isHost && p.isOnline !== false);
                if (!hasActiveHostNow) {
                    const onlinePlayerKeys = Object.keys(data).filter(k => data[k].isOnline !== false).sort();

                    if (onlinePlayerKeys[0] === myPlayerId) {
                        set(ref(db, `rooms/${selectedGame}/players/${myPlayerId}/isHost`), true);

                        Object.keys(data).forEach(k => {
                            if (data[k].isHost && k !== myPlayerId) {
                                set(ref(db, `rooms/${selectedGame}/players/${k}/isHost`), false);
                            }
                        });
                    }
                }
            }
        };

        if (hostLost && myPlayerId && isJoined) {
            setMigrationCountdown(30);
            timer = setInterval(() => {
                setMigrationCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        triggerMigration();
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            setMigrationCountdown(null);
        }
        return () => clearInterval(timer);
    }, [hostLost, myPlayerId, isJoined, selectedGame]);

    // 3. DOŁĄCZANIE Z ZABEZPIECZENIEM PRZED DUCHAMI I ZOMBIE
    const handleJoin = async () => {
        const cleanedName = playerName.trim();
        if (cleanedName === '') return;

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const snapshot = await get(playersRef);
        const data = snapshot.val() || {};

        // ZABEZPIECZENIE: Znak zapytania przy `name?.toLowerCase()` zapobiega 
        // wywaleniu kodu, gdy w bazie zostanie uszkodzony gracz bez imienia!
        const existingPlayerKey = Object.keys(data).find(
            key => data[key].name?.toLowerCase() === cleanedName.toLowerCase()
        );

        let targetPlayerRef;
        let finalIsHost = isHost;

        if (existingPlayerKey) {
            const existingPlayer = data[existingPlayerKey];

            // Jeśli imię istnieje, wpuszczamy gracza z powrotem na jego stare miejsce
            targetPlayerRef = ref(db, `rooms/${selectedGame}/players/${existingPlayerKey}`);
            setMyPlayerId(existingPlayerKey);
            finalIsHost = existingPlayer.isHost || isHost;
            setIsHost(finalIsHost);
        } else {
            if (isHost) {
                set(ref(db, `rooms/${selectedGame}/gameState`), null);
            }
            const newPlayerRef = push(playersRef);
            targetPlayerRef = newPlayerRef;
            setMyPlayerId(newPlayerRef.key);
        }

        set(targetPlayerRef, { name: cleanedName, isHost: finalIsHost, isOnline: true });
        onDisconnect(targetPlayerRef).update({ isOnline: false });
        setIsJoined(true);
        setNameError('');
    };

    const handleBackToMenu = () => {
        if (myPlayerId) {
            remove(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
        }

        setSelectedGame(null);
        setIsJoined(false);
        setPlayerName('');
        setIsHost(false);
        setMyPlayerId(null);
        setHostExists(false);
        setHostLost(false);
        setNameError('');
    };

    // NOWA FUNKCJA: Całkowite czyszczenie pokoju z zewnątrz
    const handleEmergencyReset = () => {
        set(ref(db, `rooms/${selectedGame}`), null);
    };

    return (
        <div className="app-container">
            <h1>Party Games</h1>

            {!selectedGame ? (
                <div>
                    <p>Wybierz pokój gry, do którego chcesz dołączyć:</p>
                    <div className="games-grid">
                        {gameData.games.map((game) => (
                            <button key={game.id} onClick={() => setSelectedGame(game.id)}>
                                <span className="game-title">{game.name}</span>
                                <span className="game-desc">{game.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : !isJoined ? (
                <div>
                    <h2>Pokój: {gameData.games.find(g => g.id === selectedGame).name}</h2>
                    <p>Wpisz swoje imię, aby wejść:</p>
                    <input
                        type="text"
                        value={playerName}
                        onChange={(e) => {
                            setPlayerName(e.target.value);
                            setNameError('');
                        }}
                        placeholder="Twoje imię..."
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        style={{ borderColor: nameError ? '#ff4444' : '' }}
                    />

                    {nameError && (
                        <p style={{ color: '#ff4444', fontSize: '0.9rem', marginTop: '5px', fontWeight: 'bold' }}>
                            {nameError}
                        </p>
                    )}

                        {hostExists ? (
                            <div style={{ marginBottom: '20px', marginTop: '15px' }}>
                                <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '10px', fontStyle: 'italic' }}>
                                    🔒 Ten pokój ma już aktywnego Hosta. Dołączasz jako gracz.
                                </p>
                                {/* Stary, odsłonięty przycisk został stąd usunięty! */}
                            </div>
                        ) : (
                            <div style={{ marginBottom: '20px', marginTop: '15px', textAlign: 'left' }}>
                                <label style={{ cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={isHost}
                                        onChange={(e) => setIsHost(e.target.checked)}
                                        style={{ width: 'auto', marginRight: '10px' }}
                                    />
                                    Jestem Hostem (Dowodzę stołem)
                                </label>
                            </div>
                        )}

                        <button onClick={handleJoin}>Wejdź do pokoju</button>
                        <button onClick={handleBackToMenu} style={{ backgroundColor: 'transparent', border: 'none', marginTop: '10px', fontSize: '1rem', textDecoration: 'underline' }}>Wróć do wyboru gier</button>

                        {/* Ukryty przycisk awaryjny - pojawia się tylko, gdy wpiszesz tajne hasło w polu imienia */}
                        {playerName.toUpperCase() === 'RESET' && (
                            <div style={{ marginTop: '30px', animation: 'fadeIn 0.3s ease' }}>
                                <button
                                    onClick={() => {
                                        if (window.confirm("⚠️ UWAGA: Czy na pewno chcesz całkowicie wyczyścić ten pokój? Wszyscy obecni gracze zostaną wyrzuceni!")) {
                                            handleEmergencyReset();
                                            setPlayerName('');
                                        }
                                    }}
                                    style={{ backgroundColor: '#ff4444', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.9rem', padding: '10px 20px', fontWeight: 'bold', cursor: 'pointer' }}
                                >
                                    ⚠️ POTWIERDŹ AWARYJNY RESET
                                </button>
                            </div>
                        )}

                </div>
            ) : (
                <div>
                    <h2>Grasz w: {gameData.games.find(g => g.id === selectedGame).name}</h2>

                    {migrationCountdown !== null && (
                        <div style={{ backgroundColor: '#ff4444', color: '#fff', padding: '12px', borderRadius: '8px', marginBottom: '25px', fontWeight: 'bold', fontSize: '0.9rem', boxShadow: '0 4px 15px rgba(255, 68, 68, 0.4)' }}>
                            ⚠️ Host utracił połączenie. Przekazanie stołu za: {migrationCountdown}s...
                        </div>
                    )}

                    {selectedGame === 'never-have-i-ever' && (
                        <NeverHaveIEver isHost={isHost} onLeave={handleBackToMenu} />
                    )}

                    {selectedGame === 'truth-or-dare' && (
                        <TruthOrDare isHost={isHost} onLeave={handleBackToMenu} playerName={playerName} />
                    )}

                    {selectedGame === 'impostor' && (
                        <Impostor isHost={isHost} onLeave={handleBackToMenu} myPlayerId={myPlayerId} />
                    )}

                    {selectedGame === 'mafia' && (
                        <Mafia isHost={isHost} onLeave={handleBackToMenu} myPlayerId={myPlayerId} />
                    )}

                    <div style={{ marginTop: '40px', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '20px' }}>
                        <h3>Gracze przy stole:</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                            {playersList.length > 0 ? playersList.map(p => (
                                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', opacity: p.isOnline === false ? 0.5 : 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '20px', fontSize: '0.9rem' }}>
                                    {p.name} {p.isOnline === false && '💤'}

                                    {isHost && p.id !== myPlayerId && (
                                        <button
                                            onClick={() => remove(ref(db, `rooms/${selectedGame}/players/${p.id}`))}
                                            style={{ background: 'transparent', border: 'none', color: '#ff4444', marginLeft: '8px', padding: '0 5px', cursor: 'pointer', fontWeight: 'bold' }}
                                            title="Wyrzuć gracza na stałe"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </span>
                            )) : <span style={{ opacity: 0.8 }}>Pusty pokój...</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;