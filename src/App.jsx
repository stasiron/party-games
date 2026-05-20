import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, set, push, remove, onValue, onDisconnect, get, update } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import NeverHaveIEver from './NeverHaveIEver';
import Impostor from './Impostor';
import TruthOrDare from './TruthOrDare';
import Mafia from './Mafia';
import DarkStories from './DarkStories';
import './App.css';

function App() {
    const [selectedGame, setSelectedGame] = useState(null);
    const [playerName, setPlayerName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [nameError, setNameError] = useState('');

    const [playersList, setPlayersList] = useState([]);
    /** Tylko węzły `players` per gra — bez pobierania całego `rooms` (gameState / isLocked). */
    const [presenceByGame, setPresenceByGame] = useState({});
    const [myPlayerId, setMyPlayerId] = useState(null);
    const [hostExists, setHostExists] = useState(false);

    const [hostLost, setHostLost] = useState(false);
    const [migrationCountdown, setMigrationCountdown] = useState(null);
    const [isRoomLocked, setIsRoomLocked] = useState(false);

    const [lobbyMessage, setLobbyMessage] = useState(''); // Komunikat o wyrzuceniu widoczny w lobby
    const isLeavingVoluntarily = useRef(false);           // Odróżnia wyjście gracza od wyrzucenia przez Hosta

    // STANY: Dla tajnego panelu administratora pod logo
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [adminCommand, setAdminCommand] = useState('');

    const globalPlayersList = useMemo(() => {
        const all = [];
        for (const gameId of Object.keys(presenceByGame)) {
            const players = presenceByGame[gameId];
            if (!players) continue;
            const gameObj = gameData.games.find((g) => g.id === gameId);
            const roomLabel = gameObj ? gameObj.name : gameId;
            for (const pId of Object.keys(players)) {
                const p = players[pId];
                all.push({
                    id: `${gameId}:${pId}`,
                    gameName: roomLabel,
                    ...p,
                });
            }
        }
        return all;
    }, [presenceByGame]);

    const currentGameMeta = useMemo(
        () => (selectedGame ? gameData.games.find((g) => g.id === selectedGame) : null),
        [selectedGame]
    );

    /** Pełny adres z parametrem `game` — QR i kopiowanie linku dla hosta. */
    const roomInviteUrl = useMemo(() => {
        if (!selectedGame || !isJoined || !isHost || typeof window === 'undefined') return '';
        try {
            const u = new URL(window.location.href);
            u.searchParams.set('game', selectedGame);
            u.hash = '';
            return u.toString();
        } catch {
            return '';
        }
    }, [selectedGame, isJoined, isHost]);

    // Wejście z linku / QR: ?game=<id_gry>
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const gameFromUrl = params.get('game');
        if (!gameFromUrl || !gameData.games.some((g) => g.id === gameFromUrl)) return;
        const t = setTimeout(() => {
            setSelectedGame(gameFromUrl);
            setLobbyMessage('');
            setShowAdminPanel(false);
        }, 0);
        return () => clearTimeout(t);
    }, []);

    // =========================================================================
    // POPRAWIONY EFEKT 1: NASŁUCHIWANIE GRACZY, SYSTEM ISKICKED I AUTOMATYCZNA CZYSTKA POKOJU
    // =========================================================================
    useEffect(() => {
        if (!selectedGame) return;

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const unsubscribe = onValue(playersRef, (snapshot) => {
            let data = snapshot.val() || {};

            const zombieKeys = Object.keys(data).filter(
                (key) => !data[key]?.name || String(data[key].name).trim() === ''
            );
            if (zombieKeys.length > 0) {
                const updates = {};
                zombieKeys.forEach((key) => {
                    updates[`rooms/${selectedGame}/players/${key}`] = null;
                });
                update(ref(db), updates);
                data = { ...data };
                zombieKeys.forEach((k) => {
                    delete data[k];
                });
            }

            const playersArray = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));
            setPlayersList(playersArray);

            const activeHost = playersArray.find(player => player.isHost === true && player.isOnline !== false);
            setHostExists(!!activeHost);

            if (isJoined && myPlayerId) {
                const myData = data[myPlayerId];

                // PANCERNE WYRZUCANIE: Jeśli nasz profil zniknął lub dostał flagę isKicked
                if (!myData || myData.isKicked) {
                    if (myData?.isKicked) {
                        // Anulujemy onDisconnect i sprzątamy swój rekord, by zapobiec pętlom ponownego wchodzenia
                        onDisconnect(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`)).cancel();
                        remove(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
                    }

                    // Jeśli nie wyszliśmy sami, pokazujemy informację w lobby
                    if (!isLeavingVoluntarily.current) {
                        setLobbyMessage('⚠️ Zostałeś wyrzucony z pokoju przez Hosta.');
                    }

                    setSelectedGame(null);
                    setIsJoined(false);
                    setPlayerName('');
                    setIsHost(false);
                    setMyPlayerId(null);
                    setHostExists(false);
                    setHostLost(false);
                    setNameError('');
                } else {
                    if (myData.isOnline === false) {
                        set(ref(db, `rooms/${selectedGame}/players/${myPlayerId}/isOnline`), true);
                    }
                    setIsHost(myData.isHost || false);

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
    }, [selectedGame, isJoined, myPlayerId]);

    // =========================================================================
    // POPRAWIONY EFEKT 2: STOPER I MIGRACJA HOSTA (BEZ BŁĘDÓW ESLINT!)
    // =========================================================================
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
            // NAPRAWA: Opakowanie w setTimeout(..., 0) przenosi akcję do kolejki asynchronicznej,
            // co całkowicie likwiduje błąd ESLinta i zapobiega kaskadowym renderom!
            const t = setTimeout(() => setMigrationCountdown(30), 0);

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

            return () => {
                clearTimeout(t);
                clearInterval(timer);
            };
        } else {
            // NAPRAWA: Bezpieczne, asynchroniczne zerowanie licznika
            const t = setTimeout(() => setMigrationCountdown(null), 0);
            return () => clearTimeout(t);
        }
    }, [hostLost, myPlayerId, isJoined, selectedGame]);

    // =========================================================================
    // POPRAWIONY EFEKT 3: GLOBALNE NASŁUCHIWANIE GRACZY ONLINE + CZYSTKA MENU GŁÓWNEGO
    // =========================================================================
    useEffect(() => {
        if (selectedGame) return;

        const unsubs = gameData.games.map((game) => {
            const gameId = game.id;
            const playersRef = ref(db, `rooms/${gameId}/players`);
            return onValue(playersRef, (snapshot) => {
                let raw = snapshot.val() || {};
                const zombieKeys = Object.keys(raw).filter(
                    (pId) => !raw[pId]?.name || String(raw[pId].name).trim() === ''
                );
                if (zombieKeys.length > 0) {
                    const updates = {};
                    zombieKeys.forEach((k) => {
                        updates[`rooms/${gameId}/players/${k}`] = null;
                    });
                    update(ref(db), updates);
                    raw = { ...raw };
                    zombieKeys.forEach((k) => {
                        delete raw[k];
                    });
                }
                setPresenceByGame((prev) => ({ ...prev, [gameId]: raw }));
            });
        });

        return () => {
            unsubs.forEach((u) => u());
            setPresenceByGame({});
        };
    }, [selectedGame]);

    // 4. OBSŁUGA TAJNYCH KOMEND ADMINISTRATORA pod logo
    const handleAdminCommand = useCallback(() => {
        const cleanedCmd = adminCommand.trim().toUpperCase();

        if (cleanedCmd === 'CLEAR') {
            if (window.confirm("Reseetujemy całą bazę? Wszyscy zostaną wyrzuceni.")) {
                gameData.games.forEach(game => {
                    set(ref(db, `rooms/${game.id}/players`), null);
                });
                setLobbyMessage('🧹 Konsola: Wyczyszczono wszystkich graczy ze wszystkich pokoi.');
                setAdminCommand('');
                setShowAdminPanel(false);
            }
        } else if (cleanedCmd === '') {
            return;
        } else {
            alert("❌ Nieznana komenda administratora.");
        }
    }, [adminCommand]);

    // 5. DOŁĄCZANIE DO POKOJU (NADPISYWANIE DUCHÓW / ZABEZPIECZENIEM PRZED BLOKADĄ)
    const handleJoin = async () => {
        isLeavingVoluntarily.current = false; //
        setLobbyMessage('');
        const cleanedName = playerName.trim();
        if (cleanedName === '') {
            setNameError('Podaj imię, aby wejść do pokoju.');
            return;
        }
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
        isLeavingVoluntarily.current = true; //
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
            {/* Logo z obsługą double click (Easter egg panelu admina) */}
            <h1
                onDoubleClick={() => !selectedGame && setShowAdminPanel(prev => !prev)}
                className={!selectedGame ? "main-logo-clickable" : ""}
            >
                Party Games
            </h1>

            {lobbyMessage && <p className="error-message">{lobbyMessage}</p>}

            {/* PANEL DEWELOPERSKI */}
            {showAdminPanel && !selectedGame && (
                <div className="admin-panel-container">
                    <input
                        type="text"
                        value={adminCommand}
                        onChange={(e) => setAdminCommand(e.target.value)}
                        placeholder="Konsola: Wpisz komendę (np. CLEAR)..."
                        onKeyDown={(e) => e.key === 'Enter' && handleAdminCommand()}
                        className="input-admin-console"
                    />
                </div>
            )}

            {!selectedGame ? (
                <div>
                    <p>Wybierz pokój gry, do którego chcesz dołączyć:</p>
                    <div className="games-grid">
                        {gameData.games.map((game) => (
                            <button key={game.id} onClick={() => {
                                setSelectedGame(game.id);
                                setLobbyMessage('');
                                setShowAdminPanel(false);
                            }}>
                                <span className="game-title">{game.name}</span>
                                <span className="game-desc">{game.description}</span>
                            </button>
                        ))}
                    </div>

                    {/* LISTA GRACZY ONLINE W GŁÓWNYM MENU */}
                    <div className="players-section">
                        <h3>Wszyscy gracze online:</h3>
                        <div className="players-list">
                            {globalPlayersList.length > 0 ? globalPlayersList.map(p => (
                                <span key={p.id} className={`player-tag ${p.isOnline === false ? 'player-offline' : ''}`}>
                                    {p.name} <span className="global-player-game">({p.gameName})</span> {p.isOnline === false && '💤'}
                                </span>
                            )) : <span className="empty-room-text">Brak graczy online. Rozpocznij imprezę!</span>}
                        </div>
                    </div>
                </div>
            ) : (
                <div>
                    {!isJoined ? (
                        <div>
                            <h2>Pokój: {currentGameMeta?.name}</h2>
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
                                required
                                aria-invalid={nameError ? 'true' : 'false'}
                            />

                            {nameError && <p className="error-message">{nameError}</p>}

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

                            <button onClick={handleJoin} disabled={playerName.trim() === ''}>Wejdź do pokoju</button>
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
                            <h2>Grasz w: {currentGameMeta?.name}</h2>

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
                                <NeverHaveIEver isHost={isHost} onLeave={handleBackToMenu} roomInviteUrl={roomInviteUrl} />
                            )}

                            {selectedGame === 'truth-or-dare' && (
                                <TruthOrDare isHost={isHost} onLeave={handleBackToMenu} playerName={playerName} roomInviteUrl={roomInviteUrl} />
                            )}

                            {selectedGame === 'impostor' && (
                                <Impostor isHost={isHost} onLeave={handleBackToMenu} myPlayerId={myPlayerId} roomInviteUrl={roomInviteUrl} />
                            )}

                            {selectedGame === 'mafia' && (
                                <Mafia
                                    isHost={isHost}
                                    onLeave={handleBackToMenu}
                                    myPlayerId={myPlayerId}
                                    tablePlayers={playersList}
                                    roomInviteUrl={roomInviteUrl}
                                />
                            )}

                            {selectedGame === 'dark-stories' && (
                                <DarkStories isHost={isHost} onLeave={handleBackToMenu} roomInviteUrl={roomInviteUrl} />
                            )}
                        </div>
                    )}

                    {/* SEKCJA LISTY GRACZY W POKOJU */}
                    <div className="players-section">
                        <h3>Gracze przy stole:</h3>
                        <div className="players-list">
                            {playersList.length > 0 ? playersList.map(p => (
                                <span key={p.id} className={`player-tag ${p.isOnline === false ? 'player-offline' : ''}`}>
                                    {p.name} {p.isOnline === false && '💤'}

                                    {isJoined && isHost && p.id !== myPlayerId && (
                                        <button
                                            onClick={() => set(ref(db, `rooms/${selectedGame}/players/${p.id}/isKicked`), true)}
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

            {/* Wersja w rogu ekranu */}
            <div className="version-tag">v0.1.8</div>
        </div>
    );
}

export default App;