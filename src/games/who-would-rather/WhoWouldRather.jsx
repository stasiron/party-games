import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { useRtdbSync } from '../../lib/useRtdbSync';
import { useTurnVibration } from '../../lib/useTurnVibration';
import { buildDeckFromContentMap, getWhoWouldRatherCategories } from '../../lib/gameContentUtils';
import { resolveNextDeckItemFromState } from '../../lib/deckStateUtils';
import { useLocale } from '../../locales/LocaleContext';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import { pickRandomPlayerName, resolveNextTurnPlayerName } from '../../lib/playerNames';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import GameCategoryLobby from '../../components/GameCategoryLobby';
import AdminDeckControlPanel from '../../components/AdminDeckControlPanel';
import TurnHeader from '../../components/TurnHeader';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { isTurnForPhoneOwner, isCurrentPlayerGuest } from '../../lib/guestPlayers';
import { useCategorySelection } from '../../lib/useCategorySelection';
import GameHostResetButton from '../../components/GameHostResetButton';
import GameRoomExitBar from '../../components/GameRoomExitBar';

const WHO_WOULD_RATHER_ADDITIONAL_STATE = { currentPlayerName: '', puppetNextPlayerName: '' };

function WhoWouldRather({
    isHost,
    canManageRoom = isHost,
    onLeave,
    gameId = 'who-would-rather',
    playerName,
    myPlayerId,
    tablePlayers = [],
    vibrationEnabled,
    roomId,
    shareOptions,
    hasAdminPowers = false,
}) {
    const { gameContent, t } = useLocale();
    const section = gameContent.whoWouldRather;

    const playableCategories = useMemo(
        () => getWhoWouldRatherCategories(section),
        [section]
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
    } = useCategorySelection(playableCategories);

    const buildDeckFromCategoryIds = useCallback(
        (categoryIds) => buildDeckFromContentMap(categoryIds, section?.dilemmas),
        [section]
    );

    const getCategoryIds = useCallback(() => selectedCategories, [selectedCategories]);

    const getExtraStartFields = useCallback(
        () => ({ currentPlayerName: pickRandomPlayerName(tablePlayers, null) }),
        [tablePlayers]
    );

    const fingerprintExtra = useCallback(
        (data) => `${data.currentPlayerName || ''}:${data.puppetNextPlayerName || ''}`,
        []
    );

    const {
        roomData,
        deckLength,
        currentQuestion: currentDilemma,
        currentIndex,
        startGame,
        forceResetTable,
        isLastQuestion: atLastDilemma,
    } = useShuffledQuestionDeck(roomId, {
        buildDeckFromCategoryIds,
        getCategoryIds,
        indexKey: 'currentDilemmaIndex',
        legacyDeckKey: 'shuffledDilemmas',
        additionalState: WHO_WOULD_RATHER_ADDITIONAL_STATE,
        getExtraStartFields,
        fingerprintExtra,
        metricsGameId: 'who-would-rather',
    });

    const { rtdbBusy, syncOpts } = useRtdbSync();

    useTurnVibration({
        currentPlayerName: roomData.currentPlayerName,
        tablePlayers,
        myPlayerId,
        vibrationEnabled,
    });

    const nextTurn = useCallback(async () => {
        if (currentIndex >= deckLength - 1) return;

        const nextPlayer = resolveNextTurnPlayerName(roomData, tablePlayers);

        await update(
            ref(db, `rooms/${roomId}/gameState`),
            {
                currentDilemmaIndex: currentIndex + 1,
                currentPlayerName: nextPlayer,
                puppetNextPlayerName: null,
            },
            syncOpts
        );
    }, [currentIndex, deckLength, roomData, syncOpts, roomId, tablePlayers]);

    const prevTurn = useCallback(async () => {
        if (currentIndex <= 0) return;

        await update(
            ref(db, `rooms/${roomId}/gameState`),
            { currentDilemmaIndex: currentIndex - 1 },
            syncOpts
        );
    }, [currentIndex, syncOpts, roomId]);

    const isSharedPhoneTurn = isTurnForPhoneOwner(
        tablePlayers,
        myPlayerId,
        roomData.currentPlayerName
    );

    const sharedPhoneGuestName = useMemo(() => {
        if (!isCurrentPlayerGuest(tablePlayers, roomData.currentPlayerName) || !isSharedPhoneTurn) {
            return null;
        }
        return roomData.currentPlayerName;
    }, [tablePlayers, isSharedPhoneTurn, roomData.currentPlayerName]);

    const nextDilemma = useMemo(
        () => resolveNextDeckItemFromState(roomData, buildDeckFromCategoryIds, {
            indexKey: 'currentDilemmaIndex',
            legacyDeckKey: 'shuffledDilemmas',
        }),
        [roomData, buildDeckFromCategoryIds]
    );

    const previewContent = nextDilemma ? (
        <div className="wwr-dilemma-grid admin-next-preview__dilemma">
            <div className="content-panel content-panel--dark wwr-option">
                <span className="wwr-option-label">A</span>
                <p className="wwr-option-text">{nextDilemma.a}</p>
            </div>
            <div className="content-panel content-panel--dark wwr-option wwr-option--b">
                <span className="wwr-option-label">B</span>
                <p className="wwr-option-text">{nextDilemma.b}</p>
            </div>
        </div>
    ) : (
        <p className="admin-next-preview__empty">{t('gameUi.showNextPreviewEnd')}</p>
    );

    return (
        <div>
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.who-would-rather.name')}>
                        <GameRulesList gameId="who-would-rather" />
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
                        renderSharedPhoneBanner={(guestName) => (
                            <p className="tod-shared-phone-banner">
                                Współdzielony telefon — odpowiada: <strong>{guestName}</strong>
                            </p>
                        )}
                    />

                    <p className={`wwr-choice-text ${isSharedPhoneTurn ? 'active' : 'inactive'}`}>
                        {isSharedPhoneTurn
                            ? sharedPhoneGuestName
                                ? `Powiedz na głos, co wybiera ${sharedPhoneGuestName}: A czy B?`
                                : 'Powiedz na głos: wybierasz A czy B?'
                            : 'Czekamy na odpowiedź gracza...'}
                    </p>

                    <p className="wwr-progress-text">
                        Dylemat {currentIndex + 1} z {deckLength}
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

                    <AdminDeckControlPanel
                        roomData={roomData}
                        roomId={roomId}
                        gameId="who-would-rather"
                        myPlayerId={myPlayerId}
                        tablePlayers={tablePlayers}
                        previewContent={previewContent}
                        busy={rtdbBusy}
                        deckSkipOptions={{
                            indexKey: 'currentDilemmaIndex',
                            legacyDeckKey: 'shuffledDilemmas',
                        }}
                    />

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row wwr-nav-buttons">
                                <button
                                    onClick={prevTurn}
                                    disabled={currentIndex === 0 || rtdbBusy}
                                    className={`btn-wwr-prev ${currentIndex === 0 ? 'disabled' : ''}`}
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

export default WhoWouldRather;
