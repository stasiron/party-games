import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ref, set, get, update } from 'firebase/database';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.json';
import { getTruthOrDareCategories } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { shuffleArray } from '../../lib/shuffle';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';

function TruthOrDare({ isHost, onLeave, playerName, roomInviteUrl, vibrationEnabled }) {
    const playableCategories = useMemo(
        () => getTruthOrDareCategories(gameData.truthOrDare),
        []
    );

    const [selectedCategories, setSelectedCategories] = useState([]);
    const [isSafeMode, setIsSafeMode] = useState(false);

    const defaultRoomState = useMemo(
        () => ({
            isGameStarted: false,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: '',
            truthPool: [],
            darePool: [],
            playerStats: {},
        }),
        []
    );
    const roomData = useRoomGameState('truth-or-dare', defaultRoomState);
    const lastVibratedTurnRef = useRef('');

    useEffect(() => {
        lastVibratedTurnRef.current = '';
    }, [roomData.currentPlayerName]);

    const triggerPlayerVibration = useCallback(() => {
        if (!vibrationEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        try {
            navigator.vibrate(120);
        } catch {
            /* vibrate API */
        }
    }, [vibrationEnabled]);

    useEffect(() => {
        if (!vibrationEnabled || !roomData.currentPlayerName || !playerName) return;
        const turnKey = roomData.currentPlayerName.trim();
        if (turnKey !== playerName.trim()) return;
        if (lastVibratedTurnRef.current === turnKey) return;
        lastVibratedTurnRef.current = turnKey;
        triggerPlayerVibration();
    }, [roomData.currentPlayerName, playerName, triggerPlayerVibration, vibrationEnabled]);

    // OPTYMALIZACJA: Cachowanie funkcji
    const toggleCategory = useCallback((catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    }, []);

    const getRandomPlayer = useCallback(async (excludeName) => {
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
    }, []);

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;

        let allTruths = [];
        let allDares = [];

        selectedCategories.forEach((catId) => {
            const pack = gameData.truthOrDare.content[catId];
            if (!pack) return;
            if (Array.isArray(pack.truth)) {
                allTruths = [...allTruths, ...pack.truth];
            }
            if (Array.isArray(pack.dare)) {
                allDares = [...allDares, ...pack.dare];
            }
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
    }, [selectedCategories, getRandomPlayer]);

    const drawContent = useCallback((type) => {
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

        const selectedItem =
            availableOptions[Math.floor(Math.random() * availableOptions.length)];
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
    }, [roomData, isSafeMode]);

    const nextTurn = useCallback(async () => {
        const nextPlayer = await getRandomPlayer(roomData.currentPlayerName);
        update(ref(db, 'rooms/truth-or-dare/gameState'), {
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: nextPlayer
        });
    }, [roomData.currentPlayerName, getRandomPlayer]);

    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/truth-or-dare/gameState'), null);
        setSelectedCategories([]);
        setIsSafeMode(false);
    }, []);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const toggleSafeMode = useCallback(() => {
        setIsSafeMode(prev => !prev);
    }, []);

    const amICurrentPlayer = roomData.currentPlayerName?.trim() === playerName?.trim();
    const cardStateClass = amICurrentPlayer ? 'tod-card-active' : 'tod-card-disabled';

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title="Prawda czy wyzwanie">
                        <ol className="game-rules__list">
                            <li>Host wybiera kategorie i startuje grę. Aplikacja losuje gracza na kolejkę.</li>
                            <li>Wybrany gracz decyduje: <strong>Prawda</strong> lub <strong>Wyzwanie</strong> i wykonuje zadanie.</li>
                            <li>Host prowadzi stół — po wykonaniu zadania przechodzicie do następnej osoby.</li>
                            <li>Host może włączyć tryb bezpieczny (podwójne kliknięcie nagłówka „Kolej gracza”) — łagodniejsze karty.</li>
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
                            {selectedCategories.length > 0 && (
                                <div className="actions-stack">
                                    <button onClick={startGame} className="btn-main-action">
                                        Rozpocznij grę ({selectedCategories.length})
                                    </button>
                                </div>
                            )}
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze talię i wystartuje stół...</p>
                    )}
                </div>
            ) : (
                <div>
                    <div className="turn-header">
                        <h2
                            onDoubleClick={toggleSafeMode}
                            className="tod-turn-h2"
                        >
                            Kolej gracza:
                            {isSafeMode && <span className="tod-safe-mode-dot">●</span>}
                        </h2>
                        <h1 className={`tod-turn-h1 ${amICurrentPlayer ? 'active' : 'inactive'}`}>
                            {roomData.currentPlayerName}
                            {amICurrentPlayer && " (TO TY!)"}
                        </h1>
                    </div>

                    {roomData.mode === 'choice' ? (
                        <>
                            <p className={`tod-choice-text ${amICurrentPlayer ? 'active' : 'inactive'}`}>
                                {amICurrentPlayer ? "Podejmij decyzję:" : "Czekamy na wybór gracza..."}
                            </p>
                            <div className="cards-container">
                                <div
                                    className={`tod-card tod-truth ${cardStateClass}`}
                                    onClick={() => amICurrentPlayer && drawContent('truth')}
                                >
                                    <h2 className="tod-card-title text-truth">PRAWDA</h2>
                                </div>

                                <div
                                    className={`tod-card tod-dare ${cardStateClass}`}
                                    onClick={() => amICurrentPlayer && drawContent('dare')}
                                >
                                    <h2 className="tod-card-title text-dare">WYZWANIE</h2>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className={`tod-result-box ${roomData.mode === 'truth' ? 'tod-truth' : 'tod-dare'}`}>
                            {roomData.currentDifficulty > 0 && (
                                <div className="tod-stars-active">
                                    {'★'.repeat(roomData.currentDifficulty)}
                                    <span className="tod-stars-empty">{'★'.repeat(5 - roomData.currentDifficulty)}</span>
                                </div>
                            )}

                            <span className={`tod-label-span ${roomData.mode === 'truth' ? 'text-truth' : 'text-dare'}`}>
                                {roomData.mode === 'truth' ? 'Prawda' : 'Wyzwanie'}
                            </span>

                            <h3 className="tod-result-text">
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