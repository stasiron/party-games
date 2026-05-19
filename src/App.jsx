import { useState, useEffect, useRef } from 'react'; // <-- DOPISANO useRef
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
    const [isRoomLocked, setIsRoomLocked] = useState(false);

    const [lobbyMessage, setLobbyMessage] = useState(''); // Komunikat w lobby
    const isLeavingVoluntarily = useRef(false);           // Flaga świadomego wyjścia

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
                    if (!isLeavingVoluntarily.current) {
                        setLobbyMessage('⚠️ Zostałeś wyrzucony z pokoju lub stół został wyczyszczony przez Hosta.');
                    }
                    setSelectedGame(null);
                    setIsJoined(false);
                    setSelectedGame(null);
                    setIsJoined(false);
                    setPlayerName('');
                    setIsHost(false);
                    setMyPlayerId(null);
                    setHostExists(false);
                    setHostLost(false);
                    setNameError('');
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

        const lockedRef = ref(db, `rooms/${selectedGame}/isLocked`);
        const unsubscribeLocked = onValue(lockedRef, (snapshot) => {
            setIsRoomLocked(snapshot.val() || false);
        });

        return () => {
            unsubscribe();
            unsubscribeLocked();
        };
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

    // 3. DOŁĄCZANIE Z ZABEZPIECZENIEM PRZED DUCHAMI, ZOMBIE I BLOKADĄ POKOJU
    const handleJoin = async () => {
        isLeavingVoluntarily.current = false; // <-- DOPISZ TĘ LINIJKĘ
        const cleanedName = playerName.trim();
        if (cleanedName === '') return;
        if (cleanedName.toUpperCase() === 'RESET') return;

        const lockedSnapshot = await get(ref(db, `rooms/${selectedGame}/isLocked`));
        const isLocked = lockedSnapshot.val() || false;

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const snapshot = await get(playersRef);
        const data = snapshot.val() || {};

        const existingPlayerKey = Object.keys(data).find(
            key => data[key].name?.toLowerCase() === cleanedName.toLowerCase()
        );

        if (isLocked && !existingPlayerKey) {
            setNameError('🔒 Ten pokój został zablokowany przez Hosta. Rozgrywka już trwa!');
            return;
        }

        let targetPlayerRef;
        let finalIsHost = isHost;

        if (existingPlayerKey) {
            const existingPlayer = data[existingPlayerKey];
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
        isLeavingVoluntarily.current = true; // <-- DOPISZ TĘ LINIJKĘ
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

    const handleEmergencyReset = () => {
        set(ref(db, `rooms/${selectedGame}`), null);
    };

    return (
        <div className="app-container">
            <h1>Party Games</h1>

            {/* DOPISZ TĘ LINIJKĘ: Wyświetla czerwony komunikat w lobby jeśli istnieje */}
            {lobbyMessage && <p className="error-message">{lobbyMessage}</p>}

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
                        className={nameError ? 'input-error' : ''}
                    />

                    {nameError && (
                        <p className="error-message">
                            {nameError}
                        </p>
                    )}

                    {hostExists ? (
                        <div className="host-status-container">
                            <p className="host-status-text">
                                🔒 Ten pokój ma już aktywnego Hosta. Dołączasz jako gracz.
                            </p>
                        </div>
                    ) : (
                        <div className="host-checkbox-container">
                            <label className="host-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={isHost}
                                    onChange={(e) => setIsHost(e.target.checked)}
                                    className="host-checkbox-input"
                                />
                                Jestem Hostem (Dowodzę stołem)
                            </label>
                        </div>
                    )}

                    <button onClick={handleJoin}>Wejdź do pokoju</button>
                    <button onClick={handleBackToMenu} className="btn-link">Wróć do wyboru gier</button>

                    {playerName.toUpperCase() === 'RESET' && (
                        <div className="emergency-reset-container">
                            <button
                                onClick={() => {
                                    if (window.confirm("⚠️ UWAGA: Czy na pewno chcesz całkowicie wyczyścić ten pokój? Wszyscy obecni gracze zostaną wyrzuceni!")) {
                                        handleEmergencyReset();
                                        setPlayerName('');
                                    }
                                }}
                                className="btn-emergency-reset"
                            >
                                ⚠️ POTWIERDŹ AWARYJNY RESET
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div>
                    <h2>Grasz w: {gameData.games.find(g => g.id === selectedGame).name}</h2>

                    {isHost && (
                        <div className="room-lock-container">
                            <button
                                onClick={() => set(ref(db, `rooms/${selectedGame}/isLocked`), !isRoomLocked)}
                                className={`btn-lock-toggle ${isRoomLocked ? 'locked' : 'unlocked'}`}
                            >
                                {isRoomLocked ? '🔒 Pokój zablokowany (Kliknij by zmienić)' : '🔓 Pokój odblokowany (Kliknij by zmienić)'}
                            </button>
                        </div>
                    )}
                    {migrationCountdown !== null && (
                        <div className="migration-warning">
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

                    <div className="players-section">
                        <h3>Gracze przy stole:</h3>
                        <div className="players-list">
                            {playersList.length > 0 ? playersList.map(p => (
                                <span key={p.id} className={`player-tag ${p.isOnline === false ? 'player-offline' : ''}`}>
                                    {p.name} {p.isOnline === false && '💤'}

                                    {isHost && p.id !== myPlayerId && (
                                        <button
                                            onClick={() => remove(ref(db, `rooms/${selectedGame}/players/${p.id}`))}
                                            className="btn-kick"
                                            title="Wyrzuć gracza na stałe"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </span>
                            )) : <span className="empty-room-text">Pusty pokój...</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;