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
    chooseCardFromIndicesAt,
    chooseCardAtPoolIndex,
    resolveTodPoolState,
    getTodPoolLengths,
    peekTodNextCards,
    buildUpdatedPlayerStats,
    TOD_POOL_VERSION,
} from './engine';
import { resolveNextTurnPlayerName } from '../../lib/playerNames';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import TurnHeader from '../../components/TurnHeader';
import AdminDeckControlPanel from '../../components/AdminDeckControlPanel';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../../lib/guestPlayers';
import { buildRefreshTodShowLockUpdates } from '../../lib/adminDeckControls';
import { useCategorySelection } from '../../lib/useCategorySelection';
import GameHostResetButton from '../../components/GameHostResetButton';
import GameRoomExitBar from '../../components/GameRoomExitBar';

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
    canManageRoom = isHost,
    onLeave,
    gameId = 'truth-or-dare',
    playerName,
    myPlayerId,
    tablePlayers = [],
    vibrationEnabled,
    roomId,
    shareOptions,
    hasAdminPowers = false,
}) {
    const { gameContent, t } = useLocale();
    const truthOrDareSection = gameContent.truthOrDare;

    const playableCategories = useMemo(
        () => getTruthOrDareCategories(truthOrDareSection),
        [truthOrDareSection]
    );

    const [isSafeMode, setIsSafeMode] = useState(false);

    const contentByCategory = truthOrDareSection?.content;

    const defaultRoomState = useMemo(
        () => ({
            isGameStarted: false,
            mode: 'choice',
            currentText: '',
            currentDifficulty: 0,
            currentPlayerName: '',
            puppetNextPlayerName: '',
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
                showNextPreview: data.showNextPreview === true,
                showOperatorPlayerId: data.showOperatorPlayerId || '',
                showLockedTruthIdx: data.showLockedTruthIdx ?? null,
                showLockedDareIdx: data.showLockedDareIdx ?? null,
                showPreviewDeckAnchor: data.showPreviewDeckAnchor ?? null,
                showPreviewNextIndex: data.showPreviewNextIndex ?? null,
                puppetMode: data.puppetMode === true,
                puppetOperatorPlayerId: data.puppetOperatorPlayerId || '',
                puppetNextPlayerName: data.puppetNextPlayerName || '',
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

    const lastPlayedCategoryIds = useMemo(() => {
        if (roomData.isGameStarted) return undefined;
        return Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
            ? roomData.categoryIds
            : undefined;
    }, [roomData.isGameStarted, roomData.categoryIds]);

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
    } = useCategorySelection(playableCategories, { lastPlayedCategoryIds });
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
                const forcedIndex =
                    roomData.showNextPreview === true && currentPool.length > 0
                        ? 0
                        : null;
                chosen = forcedIndex != null
                    ? chooseCardAtPoolIndex({ currentPool, atIndex: forcedIndex })
                    : chooseCard({ currentPool, ...drawOpts });
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
                const forcedIdx = roomData.showNextPreview === true && remainingIndices.length > 0
                    ? remainingIndices[0]
                    : null;

                if (!remainingIndices.length) {
                    await update(ref(db, `rooms/${roomId}/gameState`), {
                        mode: type,
                        currentText: EMPTY_POOL_MSG[type],
                        currentDifficulty: 0,
                    }, syncOpts);
                    return;
                }

                chosen = forcedIdx != null
                    ? chooseCardFromIndicesAt({ remainingIndices, basePool, atIdx: forcedIdx })
                    : chooseCardFromIndices({
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

            const lockRefresh = roomData.showNextPreview === true
                ? buildRefreshTodShowLockUpdates(roomId, {
                    ...roomData,
                    mode: type,
                    currentText: chosen.selectedItem.text,
                    currentDifficulty: chosen.selectedItem.level,
                    ...poolUpdate,
                    ...(type === 'truth'
                        ? { showLockedTruthIdx: null, showLockedTruthPos: null }
                        : { showLockedDareIdx: null, showLockedDarePos: null }),
                })
                : {};

            await update(ref(db, `rooms/${roomId}/gameState`), {
                mode: type,
                currentText: chosen.selectedItem.text,
                currentDifficulty: chosen.selectedItem.level,
                ...poolUpdate,
                ...(type === 'truth'
                    ? { showLockedTruthIdx: null, showLockedTruthPos: null }
                    : { showLockedDareIdx: null, showLockedDarePos: null }),
                playerStats: newStats,
                ...lockRefresh,
            }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData, isSafeMode, syncOpts, roomId, contentByCategory]);

    const nextTurn = useCallback(async () => {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        try {
            const nextPlayer = resolveNextTurnPlayerName(roomData, tablePlayers);
            await update(ref(db, `rooms/${roomId}/gameState`), {
                mode: 'choice',
                currentText: '',
                currentDifficulty: 0,
                currentPlayerName: nextPlayer,
                puppetNextPlayerName: null,
            }, syncOpts);
        } finally {
            actionLockRef.current = false;
        }
    }, [roomData, syncOpts, roomId, tablePlayers]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        setIsSafeMode(false);
    }, [roomId]);

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

    const todNextPeek = useMemo(
        () => peekTodNextCards(roomData, contentByCategory),
        [roomData, contentByCategory]
    );

    const todPreviewContent = (
        <div className="admin-next-preview__tod">
            <div className="admin-next-preview__tod-row">
                <span className="admin-next-preview__tod-label text-truth">
                    {t('gameUi.showNextPreviewTruth')}
                </span>
                <p className="admin-next-preview__tod-text">
                    {todNextPeek.truth?.text ?? t('gameUi.showNextPreviewPoolEmpty')}
                </p>
            </div>
            <div className="admin-next-preview__tod-row">
                <span className="admin-next-preview__tod-label text-dare">
                    {t('gameUi.showNextPreviewDare')}
                </span>
                <p className="admin-next-preview__tod-text">
                    {todNextPeek.dare?.text ?? t('gameUi.showNextPreviewPoolEmpty')}
                </p>
            </div>
        </div>
    );

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.truth-or-dare.name')}>
                        <GameRulesList gameId="truth-or-dare" />
                    </GameRules>

                    <GameCategoryLobby
                        gameId={gameId}
                        isHost={isHost}
                        categories={playableCategories}
                        selectedIds={selectedCategories}
                        onToggle={toggleCategory}
                        onStart={startGame}
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

                    <AdminDeckControlPanel
                        roomData={roomData}
                        roomId={roomId}
                        gameId="truth-or-dare"
                        myPlayerId={myPlayerId}
                        tablePlayers={tablePlayers}
                        previewContent={todPreviewContent}
                        contentByCategory={contentByCategory}
                        safeMode={isSafeMode}
                        busy={rtdbBusy}
                    />

                    {isHost && (
                        <div className="host-controls">
                            {roomData.mode !== 'choice' && (
                                <button onClick={nextTurn} className="btn-main-action" disabled={rtdbBusy}>
                                    Zakończ kolejkę i losuj gracza
                                </button>
                            )}
                            <HostShareOptions shareOptions={shareOptions} />
                            <GameHostResetButton
                                gameId={gameId}
                                canManageRoom={canManageRoom}
                                onLeave={onLeave}
                                onReset={forceResetTable}
                            />
                        </div>
                    )}
                </div>
            )}

            <GameRoomExitBar
                gameId={gameId}
                canManageRoom={canManageRoom}
                onLeave={onLeave}
                forceResetTable={forceResetTable}
            />
        </div>
    );
}

export default TruthOrDare;
