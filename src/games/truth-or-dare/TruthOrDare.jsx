import { useState, useCallback, useMemo, useRef } from 'react';
import { ref } from 'firebase/database';
import { set, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { useRtdbSync } from '../../lib/useRtdbSync';
import { useTurnVibration } from '../../lib/useTurnVibration';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { getTruthOrDareCategories } from '../../lib/gameContentUtils';
import { recordGameStarted } from '../../lib/appMetrics.js';
import { useLocale } from '../../locales/LocaleContext';
import { useRoomGameState } from '../../lib/useRoomGameState';
import {
    pickRandomPlayerName,
    buildInitialStats,
    buildPools,
    buildInitialPoolIndices,
    chooseCard,
    chooseCardFromIndices,
    resolveTodPoolState,
    getTodPoolLengths,
    buildUpdatedPlayerStats,
    TOD_POOL_VERSION,
} from './engine';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import TurnHeader from '../../components/TurnHeader';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../../lib/guestPlayers';
import { useCategorySelection } from '../../lib/useCategorySelection';

const EMPTY_POOL_MSG = {
    truth: 'Koniec pytań w tej puli! Musisz wybrać Wyzwanie.',
    dare: 'Koniec wyzwań w tej puli! Musisz wybrać Prawdę.',
};

const SAFE_EMPTY_MSG = {
    truth: 'Brak bezpiecznych pytań! Musisz wybrać Wyzwanie.',
    dare: 'Brak bezpiecznych wyzwań! Musisz wybrać Prawdę.',
};

function TruthOrDare({
    isHost,
    onLeave,
    playerName,
    myPlayerId,
    tablePlayers = [],
    vibrationEnabled,
    roomId,
    shareOptions,
}) {
    const { gameContent, t } = useLocale();
    const truthOrDareSection = gameContent.truthOrDare;

    const playableCategories = useMemo(
        () => getTruthOrDareCategories(truthOrDareSection),
        [truthOrDareSection]
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);
    const [isSafeMode, setIsSafeMode] = useState(false);

    const contentByCategory = truthOrDareSection?.content;

    const defaultRoomState = useMemo(
        () => ({
            isGameStarted: false,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: '',
            poolVersion: 0,
            categoryIds: [],
            remainingTruthIndices: [],
            remainingDareIndices: [],
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
                const { truthLen, dareLen } = getTodPoolLengths(data);
                fp.truthLen = truthLen;
                fp.dareLen = dareLen;
            }
            return JSON.stringify(fp);
        },
        [tablePlayers, myPlayerId]
    );

    const roomData = useRoomGameState(roomId, defaultRoomState, {
        getFingerprint: truthOrDareFingerprint,
    });
    const actionLockRef = useRef(false);
    const { rtdbBusy, syncOpts } = useRtdbSync();

    usePiGameSession(roomData.isGameStarted);

    useTurnVibration({
        currentPlayerName: roomData.currentPlayerName,
        tablePlayers,
        myPlayerId,
        vibrationEnabled,
    });

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;
        const { truths, dares } = buildPools(contentByCategory, selectedCategories);
        const poolIndices = buildInitialPoolIndices(truths, dares);
        const firstPlayer = pickRandomPlayerName(tablePlayers, null);
        const initialStats = buildInitialStats(tablePlayers);

        await set(ref(db, `rooms/${roomId}/gameState`), {
            isGameStarted: true,
            poolVersion: TOD_POOL_VERSION,
            categoryIds: selectedCategories,
            ...poolIndices,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: firstPlayer,
            playerStats: initialStats,
        }, syncOpts);
        recordGameStarted(roomId, 'truth-or-dare');
    }, [selectedCategories, syncOpts, roomId, tablePlayers, contentByCategory]);

    const drawContent = useCallback(async (type) => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        try {
            const pools = resolveTodPoolState(roomData, contentByCategory);
            const drawOpts = {
                safeMode: isSafeMode,
                playerStats: roomData.playerStats || {},
                currentPlayerName: roomData.currentPlayerName,
            };

            let chosen;
            let poolUpdate;

            if (pools.legacy) {
                const poolKey = type === 'truth' ? 'truthPool' : 'darePool';
                const currentPool = pools[poolKey];
                if (!currentPool.length) {
                    await update(ref(db, `rooms/${roomId}/gameState`), {
                        mode: type,
                        currentText: EMPTY_POOL_MSG[type],
                        currentDifficulty: 0,
                    }, syncOpts);
                    return;
                }
                chosen = chooseCard({ currentPool, ...drawOpts });
                if (!chosen) {
                    await update(ref(db, `rooms/${roomId}/gameState`), {
                        mode: type,
                        currentText: isSafeMode ? SAFE_EMPTY_MSG[type] : EMPTY_POOL_MSG[type],
                        currentDifficulty: 0,
                    }, syncOpts);
                    return;
                }
                poolUpdate = { [poolKey]: chosen.nextPool };
            } else {
                const isTruth = type === 'truth';
                const remainingIndices = isTruth ? pools.truthIndices : pools.dareIndices;
                const basePool = isTruth ? pools.baseTruths : pools.baseDares;
                const indicesKey = isTruth ? 'remainingTruthIndices' : 'remainingDareIndices';

                if (!remainingIndices.length) {
                    await update(ref(db, `rooms/${roomId}/gameState`), {
                        mode: type,
                        currentText: EMPTY_POOL_MSG[type],
                        currentDifficulty: 0,
                    }, syncOpts);
                    return;
                }

                chosen = chooseCardFromIndices({
                    remainingIndices,
                    basePool,
                    ...drawOpts,
                });

                if (!chosen) {
                    await update(ref(db, `rooms/${roomId}/gameState`), {
                        mode: type,
                        currentText: isSafeMode ? SAFE_EMPTY_MSG[type] : EMPTY_POOL_MSG[type],
                        currentDifficulty: 0,
                    }, syncOpts);
                    return;
                }
                poolUpdate = { [indicesKey]: chosen.nextIndices };
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
                ...poolUpdate,
                playerStats: newStats,
            }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData, isSafeMode, syncOpts, roomId, contentByCategory]);

    const nextTurn = useCallback(async () => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        try {
            const nextPlayer = pickRandomPlayerName(tablePlayers, roomData.currentPlayerName);
            await update(ref(db, `rooms/${roomId}/gameState`), {
                mode: 'choice',
                currentText: '',
                currentDifficulty: 0,
                currentPlayerName: nextPlayer,
            }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData.currentPlayerName, syncOpts, roomId, tablePlayers]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        resetCategoriesToAll();
        setIsSafeMode(false);
    }, [roomId, resetCategoriesToAll]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const toggleSafeMode = useCallback(() => {
        setIsSafeMode((prev) => !prev);
    }, []);

    const isSharedPhoneTurn = isTurnForPhoneOwner(
        tablePlayers,
        myPlayerId,
        roomData.currentPlayerName
    );
    const canAct = isSharedPhoneTurn && !rtdbBusy;
    const cardStateClass = canAct ? 'tod-card-active' : 'tod-card-disabled';

    const sharedPhoneGuestName = useMemo(() => {
        if (!isCurrentPlayerGuest(tablePlayers, roomData.currentPlayerName) || !isSharedPhoneTurn) {
            return null;
        }
        return roomData.currentPlayerName;
    }, [tablePlayers, isSharedPhoneTurn, roomData.currentPlayerName]);

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.truth-or-dare.name')}>
                        <GameRulesList gameId="truth-or-dare" />
                    </GameRules>

                    <GameCategoryLobby
                        isHost={isHost}
                        categories={playableCategories}
                        selectedIds={selectedCategories}
                        onToggle={toggleCategory}
                        onStart={startGame}
                        guestWaitMessage={t('gameLobby.waitForHostDeck')}
                        shareOptions={shareOptions}
                    />
                </div>
            ) : (
                <div>
                    <TurnHeader
                        currentPlayerName={roomData.currentPlayerName}
                        playerName={playerName}
                        tablePlayers={tablePlayers}
                        myPlayerId={myPlayerId}
                        titleExtra={isSafeMode ? <span className="tod-safe-mode-dot">●</span> : null}
                        onTitleDoubleClick={toggleSafeMode}
                        renderSharedPhoneBanner={(guestName) => (
                            <p className="tod-shared-phone-banner">
                                Współdzielony telefon — wybierz <strong>Prawdę</strong> lub{' '}
                                <strong>Wyzwanie</strong> za: <strong>{guestName}</strong>
                            </p>
                        )}
                    />

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
                            <HostShareOptions shareOptions={shareOptions} />
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

export default TruthOrDare;
