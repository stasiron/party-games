import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ref } from 'firebase/database';
import { set, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { getMinUiSyncMs } from '../../lib/lowPower';
import { subscribePiQueue } from '../../lib/rtdbThrottle';
import { usePiGameSession } from '../../lib/usePiGameSession';
import gameData from '../../data/gameContent.js';
import { getTruthOrDareCategories } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { shuffleArray } from '../../lib/shuffle';
import {
    pickRandomPlayerName,
    buildInitialStats,
    buildPools,
    chooseCard,
    buildUpdatedPlayerStats,
} from './engine';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../../lib/guestPlayers';

function TruthOrDare({
    isHost,
    onLeave,
    playerName,
    myPlayerId,
    tablePlayers = [],
    roomInviteUrl,
    vibrationEnabled,
    roomId,
}) {
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
    const truthOrDareFingerprint = useCallback(
        (data) => {
            if (!data) return '';
            const amI = isTurnForPhoneOwner(tablePlayers, myPlayerId, data.currentPlayerName);
            const fp = {
                isGameStarted: data.isGameStarted,
                mode: data.mode,
                currentText: data.currentText,
                currentDifficulty: data.currentDifficulty,
                currentPlayerName: data.currentPlayerName,
                playerStats: data.playerStats,
            };
            if (amI || data.mode !== 'choice') {
                fp.truthLen = data.truthPool?.length ?? 0;
                fp.dareLen = data.darePool?.length ?? 0;
            }
            return JSON.stringify(fp);
        },
        [tablePlayers, myPlayerId]
    );

    const roomData = useRoomGameState(roomId, defaultRoomState, {
        getFingerprint: truthOrDareFingerprint,
    });
    const lastVibratedTurnRef = useRef('');
    const actionLockRef = useRef(false);
    const [rtdbBusy, setRtdbBusy] = useState(false);
    const syncOpts = useMemo(() => ({ minUiMs: getMinUiSyncMs() }), []);

    useEffect(() => subscribePiQueue((depth) => setRtdbBusy(depth > 0)), []);

    usePiGameSession(roomData.isGameStarted);

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
        if (!vibrationEnabled || !roomData.currentPlayerName) return;
        if (!isTurnForPhoneOwner(tablePlayers, myPlayerId, roomData.currentPlayerName)) return;
        const turnKey = roomData.currentPlayerName.trim();
        if (lastVibratedTurnRef.current === turnKey) return;
        lastVibratedTurnRef.current = turnKey;
        triggerPlayerVibration();
    }, [roomData.currentPlayerName, tablePlayers, myPlayerId, triggerPlayerVibration, vibrationEnabled]);

    // OPTYMALIZACJA: Cachowanie funkcji
    const toggleCategory = useCallback((catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    }, []);

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;
        const { truths, dares } = buildPools(gameData.truthOrDare.content, selectedCategories);
        const firstPlayer = pickRandomPlayerName(tablePlayers, null);
        const initialStats = buildInitialStats(tablePlayers);

        await set(ref(db, `rooms/${roomId}/gameState`), {
            isGameStarted: true,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: firstPlayer,
            truthPool: shuffleArray(truths),
            darePool: shuffleArray(dares),
            playerStats: initialStats
        }, syncOpts);
    }, [selectedCategories, syncOpts, roomId, tablePlayers]);

    const drawContent = useCallback(async (type) => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        try {
        const poolKey = type === 'truth' ? 'truthPool' : 'darePool';
        const currentPool = roomData[poolKey] || [];

        if (currentPool.length === 0) {
            await update(ref(db, `rooms/${roomId}/gameState`), {
                mode: type,
                currentText: type === 'truth' ? "Koniec pytań w tej puli! Musisz wybrać Wyzwanie." : "Koniec wyzwań w tej puli! Musisz wybrać Prawdę.",
                currentDifficulty: 0
            }, syncOpts);
            return;
        }

        const chosen = chooseCard({
            currentPool,
            safeMode: isSafeMode,
            playerStats: roomData.playerStats || {},
            currentPlayerName: roomData.currentPlayerName,
        });

        if (!chosen) {
            if (isSafeMode) {
                await update(ref(db, `rooms/${roomId}/gameState`), {
                    mode: type,
                    currentText: type === 'truth' ? "Brak bezpiecznych pytań! Musisz wybrać Wyzwanie." : "Brak bezpiecznych wyzwań! Musisz wybrać Prawdę.",
                    currentDifficulty: 0
                }, syncOpts);
            } else {
                await update(ref(db, `rooms/${roomId}/gameState`), {
                    mode: type,
                    currentText: type === 'truth' ? "Koniec pytań w tej puli! Musisz wybrać Wyzwanie." : "Koniec wyzwań w tej puli! Musisz wybrać Prawdę.",
                    currentDifficulty: 0
                }, syncOpts);
            }
            return;
        }

        const newStats = buildUpdatedPlayerStats(
            roomData.playerStats || {},
            roomData.currentPlayerName,
            chosen.selectedItem.level
        );

        await update(ref(db, `rooms/${roomId}/gameState`), {
            mode: type,
            currentText: chosen.selectedItem.text,
            currentDifficulty: chosen.selectedItem.level,
            [poolKey]: chosen.nextPool,
            playerStats: newStats
        }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData, isSafeMode, syncOpts, roomId]);

    const nextTurn = useCallback(async () => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        try {
            const nextPlayer = pickRandomPlayerName(tablePlayers, roomData.currentPlayerName);
            await update(ref(db, `rooms/${roomId}/gameState`), {
                mode: 'choice',
                currentText: '',
                currentDifficulty: 0,
                currentPlayerName: nextPlayer
            }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData.currentPlayerName, syncOpts, roomId, tablePlayers]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        setSelectedCategories([]);
        setIsSafeMode(false);
    }, [roomId]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const toggleSafeMode = useCallback(() => {
        setIsSafeMode(prev => !prev);
    }, []);

    const amICurrentPlayer = roomData.currentPlayerName?.trim() === playerName?.trim();
    const isGuestTurn = isCurrentPlayerGuest(tablePlayers, roomData.currentPlayerName);
    const isSharedPhoneTurn = isTurnForPhoneOwner(
        tablePlayers,
        myPlayerId,
        roomData.currentPlayerName
    );
    const canAct = isSharedPhoneTurn && !rtdbBusy;
    const cardStateClass = canAct ? 'tod-card-active' : 'tod-card-disabled';

    const sharedPhoneGuestName = useMemo(() => {
        if (!isGuestTurn || !isSharedPhoneTurn) return null;
        return roomData.currentPlayerName;
    }, [isGuestTurn, isSharedPhoneTurn, roomData.currentPlayerName]);

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
                        <h1 className={`tod-turn-h1 ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                            {roomData.currentPlayerName}
                            {amICurrentPlayer && ' (TO TY!)'}
                            {sharedPhoneGuestName && ' (gość przy Twoim telefonie)'}
                        </h1>
                    </div>

                    {sharedPhoneGuestName && isSharedPhoneTurn && (
                        <p className="tod-shared-phone-banner">
                            Współdzielony telefon — wybierz <strong>Prawdę</strong> lub{' '}
                            <strong>Wyzwanie</strong> za: <strong>{sharedPhoneGuestName}</strong>
                        </p>
                    )}

                    {roomData.mode === 'choice' ? (
                        <>
                            <p className={`tod-choice-text ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                                {isSharedPhoneTurn
                                    ? sharedPhoneGuestName
                                        ? `Wybierz za gościa ${sharedPhoneGuestName}:`
                                        : 'Podejmij decyzję:'
                                    : 'Czekamy na wybór gracza...'}
                            </p>
                            <div className="cards-container">
                                <div
                                    className={`tod-card tod-truth ${cardStateClass}`}
                                    onClick={() => canAct && drawContent('truth')}
                                >
                                    <h2 className="tod-card-title text-truth">PRAWDA</h2>
                                </div>

                                <div
                                    className={`tod-card tod-dare ${cardStateClass}`}
                                    onClick={() => canAct && drawContent('dare')}
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

                            {roomData.currentDifficulty === 0 && isSharedPhoneTurn && (
                                <button
                                    onClick={() => canAct && drawContent(roomData.mode === 'truth' ? 'dare' : 'truth')}
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
                                <button onClick={nextTurn} className="btn-main-action" disabled={rtdbBusy}>
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