import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ref } from 'firebase/database';
import { set, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { getMinUiSyncMs } from '../../lib/lowPower';
import { subscribePiQueue } from '../../lib/rtdbThrottle';
import gameData from '../../data/gameContent.js';
import { getWhoWouldRatherCategories } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { shuffleArray } from '../../lib/shuffle';
import { pickRandomPlayerName } from '../truth-or-dare/engine';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../../lib/guestPlayers';
import { useCategorySelection } from '../../lib/useCategorySelection';

function WhoWouldRather({
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
        () => getWhoWouldRatherCategories(gameData.whoWouldRather),
        []
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);
    const defaultRoomState = useMemo(
        () => ({
            isGameStarted: false,
            shuffledDilemmas: [],
            currentDilemmaIndex: 0,
            currentPlayerName: '',
        }),
        []
    );

    const roomData = useRoomGameState(roomId, defaultRoomState, { mergeDefaults: true });
    const lastVibratedTurnRef = useRef('');
    const [rtdbBusy, setRtdbBusy] = useState(false);
    const syncOpts = useMemo(() => ({ minUiMs: getMinUiSyncMs() }), []);

    useEffect(() => subscribePiQueue((depth) => setRtdbBusy(depth > 0)), []);
    usePiGameSession(roomData.isGameStarted);

    useEffect(() => {
        lastVibratedTurnRef.current = '';
    }, [roomData.currentPlayerName]);

    const triggerPlayerVibration = useCallback(() => {
        if (!vibrationEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
            return;
        }
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

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;

        const allDilemmas = [];
        selectedCategories.forEach((catId) => {
            const pool = gameData.whoWouldRather.dilemmas[catId];
            if (Array.isArray(pool)) {
                allDilemmas.push(...pool);
            }
        });

        const firstPlayer = pickRandomPlayerName(tablePlayers, null);

        await set(
            ref(db, `rooms/${roomId}/gameState`),
            {
                isGameStarted: true,
                shuffledDilemmas: shuffleArray(allDilemmas),
                currentDilemmaIndex: 0,
                currentPlayerName: firstPlayer,
            },
            syncOpts
        );
    }, [selectedCategories, syncOpts, roomId, tablePlayers]);

    const nextTurn = useCallback(async () => {
        const dilemmas = roomData.shuffledDilemmas || [];
        if (roomData.currentDilemmaIndex >= dilemmas.length - 1) return;

        const nextPlayer = pickRandomPlayerName(tablePlayers, roomData.currentPlayerName);

        await update(
            ref(db, `rooms/${roomId}/gameState`),
            {
                currentDilemmaIndex: roomData.currentDilemmaIndex + 1,
                currentPlayerName: nextPlayer,
            },
            syncOpts
        );
    }, [
        roomData.currentDilemmaIndex,
        roomData.shuffledDilemmas,
        roomData.currentPlayerName,
        syncOpts,
        roomId,
        tablePlayers,
    ]);

    const prevTurn = useCallback(async () => {
        if (roomData.currentDilemmaIndex <= 0) return;

        await update(
            ref(db, `rooms/${roomId}/gameState`),
            {
                currentDilemmaIndex: roomData.currentDilemmaIndex - 1,
            },
            syncOpts
        );
    }, [roomData.currentDilemmaIndex, syncOpts, roomId]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        resetCategoriesToAll();
    }, [roomId, resetCategoriesToAll]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const currentDilemma = roomData.shuffledDilemmas?.[roomData.currentDilemmaIndex];
    const amICurrentPlayer = roomData.currentPlayerName?.trim() === playerName?.trim();
    const isGuestTurn = isCurrentPlayerGuest(tablePlayers, roomData.currentPlayerName);
    const isSharedPhoneTurn = isTurnForPhoneOwner(
        tablePlayers,
        myPlayerId,
        roomData.currentPlayerName
    );

    const sharedPhoneGuestName = useMemo(() => {
        if (!isGuestTurn || !isSharedPhoneTurn) return null;
        return roomData.currentPlayerName;
    }, [isGuestTurn, isSharedPhoneTurn, roomData.currentPlayerName]);

    const atLastDilemma =
        roomData.shuffledDilemmas &&
        roomData.currentDilemmaIndex >= roomData.shuffledDilemmas.length - 1;

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title="🤔 Co wolisz?">
                        <ol className="game-rules__list">
                            <li>Host wybiera kategorie i startuje grę. Aplikacja losuje gracza i pokazuje dylemat.</li>
                            <li>Wybrany gracz mówi, czy wybiera <strong>A</strong> czy <strong>B</strong> — reszta słucha i komentuje.</li>
                            <li>Host po odpowiedzi przechodzi do następnej osoby i kolejnego dylematu.</li>
                            <li>Bez oceniania — chodzi o zabawę i poznanie grupy.</li>
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
                    <div className="turn-header">
                        <h2 className="tod-turn-h2">Kolej gracza:</h2>
                        <h1 className={`tod-turn-h1 ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                            {roomData.currentPlayerName}
                            {amICurrentPlayer && ' (TO TY!)'}
                            {sharedPhoneGuestName && ' (gość przy Twoim telefonie)'}
                        </h1>
                    </div>

                    {sharedPhoneGuestName && isSharedPhoneTurn && (
                        <p className="tod-shared-phone-banner">
                            Współdzielony telefon — odpowiada: <strong>{sharedPhoneGuestName}</strong>
                        </p>
                    )}

                    <p className={`wwr-choice-text ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                        {isSharedPhoneTurn
                            ? sharedPhoneGuestName
                                ? `Powiedz na głos, co wybiera ${sharedPhoneGuestName}: A czy B?`
                                : 'Powiedz na głos: wybierasz A czy B?'
                            : 'Czekamy na odpowiedź gracza...'}
                    </p>

                    <p className="wwr-progress-text">
                        Dylemat {roomData.currentDilemmaIndex + 1} z{' '}
                        {roomData.shuffledDilemmas ? roomData.shuffledDilemmas.length : 0}
                    </p>

                    <div className="wwr-dilemma-grid">
                        <div
                            className={`content-panel content-panel--dark wwr-option ${isSharedPhoneTurn ? 'wwr-option--active' : ''}`}
                        >
                            <span className="wwr-option-label">A</span>
                            <p className="wwr-option-text">
                                {currentDilemma ? currentDilemma.a : 'Ładowanie...'}
                            </p>
                        </div>
                        <div
                            className={`content-panel content-panel--dark wwr-option wwr-option--b ${isSharedPhoneTurn ? 'wwr-option--active' : ''}`}
                        >
                            <span className="wwr-option-label">B</span>
                            <p className="wwr-option-text">
                                {currentDilemma ? currentDilemma.b : 'Ładowanie...'}
                            </p>
                        </div>
                    </div>

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row wwr-nav-buttons">
                                <button
                                    onClick={prevTurn}
                                    disabled={roomData.currentDilemmaIndex === 0 || rtdbBusy}
                                    className={`btn-wwr-prev ${roomData.currentDilemmaIndex === 0 ? 'disabled' : ''}`}
                                >
                                    Cofnij
                                </button>
                                <button
                                    onClick={nextTurn}
                                    disabled={atLastDilemma || rtdbBusy}
                                    className="btn-wwr-next"
                                >
                                    {atLastDilemma ? 'Koniec dylematów' : 'Następna osoba'}
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
                    text={isHost ? 'Zamknij pokój' : 'Wyjdź z pokoju'}
                />
            </div>
        </div>
    );
}

export default WhoWouldRather;
