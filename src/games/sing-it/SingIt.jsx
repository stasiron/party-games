import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildDeckFromContentMap, getSingItCategories } from '../../lib/gameContentUtils';
import { useLocale } from '../../locales/LocaleContext';
import { useShuffledQuestionDeck } from '../../lib/useShuffledQuestionDeck';
import { useCategorySelection } from '../../lib/useCategorySelection';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import CategorySelectionGrid from '../../components/CategorySelectionGrid';
import CollapsibleSection from '../../components/CollapsibleSection';
import GameHostResetButton from '../../components/GameHostResetButton';
import GameLobbyGuestWait from '../../components/GameLobbyGuestWait';
import GameRoomExitBar from '../../components/GameRoomExitBar';
import { getTablePlayers } from '../../lib/guestPlayers';
import { HostShareOptions } from '../../components/RoomInviteQR';

const DISPLAY_MODE_ALL = 'all';
const DISPLAY_MODE_SELECTED = 'selected';

function getOmniLabelFontSize(word) {
    const len = String(word || '').length;
    if (len > 14) return 'clamp(0.68rem, 2.1vw, 0.88rem)';
    if (len > 11) return 'clamp(0.78rem, 2.6vw, 1.02rem)';
    if (len > 8) return 'clamp(0.88rem, 3.1vw, 1.2rem)';
    return 'clamp(1.05rem, 4vw, 1.65rem)';
}

function SingItOmniWord({ word }) {
    const labelStyle = useMemo(() => ({ fontSize: getOmniLabelFontSize(word) }), [word]);

    return (
        <div className="sing-it-omni" aria-label={word}>
            <span className="sing-it-omni__slot sing-it-omni__slot--top">
                <span className="sing-it-omni__label" style={labelStyle}>{word}</span>
            </span>
            <span className="sing-it-omni__slot sing-it-omni__slot--right">
                <span className="sing-it-omni__label" style={labelStyle}>{word}</span>
            </span>
            <span className="sing-it-omni__slot sing-it-omni__slot--bottom">
                <span className="sing-it-omni__label" style={labelStyle}>{word}</span>
            </span>
            <span className="sing-it-omni__slot sing-it-omni__slot--left">
                <span className="sing-it-omni__label" style={labelStyle}>{word}</span>
            </span>
        </div>
    );
}

function SingItDisplayModeToggle({ mode, onChange, t }) {
    return (
        <div className="sing-it-mode-toggle" role="group" aria-label={t('gameSetup.singIt.displayModeTitle')}>
            <button
                type="button"
                className={`sing-it-mode-toggle__btn ${mode === DISPLAY_MODE_ALL ? 'sing-it-mode-toggle__btn--active' : ''}`}
                onClick={() => onChange(DISPLAY_MODE_ALL)}
                aria-pressed={mode === DISPLAY_MODE_ALL}
            >
                <strong>{t('gameSetup.singIt.modeAll')}</strong>
                <span className="sing-it-mode-toggle__hint">{t('gameSetup.singIt.modeAllHint')}</span>
            </button>
            <button
                type="button"
                className={`sing-it-mode-toggle__btn ${mode === DISPLAY_MODE_SELECTED ? 'sing-it-mode-toggle__btn--active' : ''}`}
                onClick={() => onChange(DISPLAY_MODE_SELECTED)}
                aria-pressed={mode === DISPLAY_MODE_SELECTED}
            >
                <strong>{t('gameSetup.singIt.modeSelected')}</strong>
                <span className="sing-it-mode-toggle__hint">{t('gameSetup.singIt.modeSelectedHint')}</span>
            </button>
        </div>
    );
}

function SingItPlayerPicker({ players, selectedIds, onToggle, t }) {
    if (!players.length) {
        return <p className="sing-it-player-picker__empty">{t('gameSetup.singIt.noPlayers')}</p>;
    }

    return (
        <ul className="sing-it-player-picker">
            {players.map((player) => {
                const checked = selectedIds.includes(player.id);
                return (
                    <li key={player.id}>
                        <label className={`sing-it-player-picker__label ${checked ? 'sing-it-player-picker__label--on' : ''}`}>
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(player.id)}
                            />
                            <span>{player.name}</span>
                        </label>
                    </li>
                );
            })}
        </ul>
    );
}

function SingItCategoryBox({ title, categories, selectedIds, onToggle }) {
    if (!categories.length) return null;

    return (
        <section className="sing-it-category-box">
            <h3 className="sing-it-category-box__title">{title}</h3>
            <CategorySelectionGrid
                categories={categories}
                selectedIds={selectedIds}
                onToggle={onToggle}
            />
        </section>
    );
}

function SingIt({
    isHost,
    canManageRoom = isHost,
    onLeave,
    gameId = 'sing-it',
    roomId,
    shareOptions,
    myPlayerId,
    tablePlayers,
}) {
    const { gameContent, t } = useLocale();
    const section = gameContent.singIt;

    const playableCategories = useMemo(
        () => getSingItCategories(section),
        [section]
    );

    const wordCategories = useMemo(
        () => playableCategories.filter((cat) => cat.group === 'words'),
        [playableCategories]
    );

    const artistCategories = useMemo(
        () => playableCategories.filter((cat) => cat.group === 'artists'),
        [playableCategories]
    );

    const lobbyCategories = useMemo(
        () => [...wordCategories, ...artistCategories],
        [wordCategories, artistCategories]
    );

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
    } = useCategorySelection(lobbyCategories);

    const activePlayers = useMemo(
        () => getTablePlayers(tablePlayers).filter((p) => !p.isGuest),
        [tablePlayers]
    );

    const defaultDisplayPlayerId = useMemo(() => {
        if (myPlayerId && activePlayers.some((p) => p.id === myPlayerId)) {
            return myPlayerId;
        }
        return activePlayers[0]?.id ?? null;
    }, [activePlayers, myPlayerId]);

    const [displayMode, setDisplayMode] = useState(DISPLAY_MODE_SELECTED);
    const [displayPlayerIds, setDisplayPlayerIds] = useState(() =>
        defaultDisplayPlayerId ? [defaultDisplayPlayerId] : []
    );

    useEffect(() => {
        if (displayMode !== DISPLAY_MODE_SELECTED) return;
        setDisplayPlayerIds((prev) => {
            const valid = prev.filter((id) => activePlayers.some((p) => p.id === id));
            if (valid.length > 0) return valid;
            return defaultDisplayPlayerId ? [defaultDisplayPlayerId] : [];
        });
    }, [activePlayers, defaultDisplayPlayerId, displayMode]);

    const toggleDisplayPlayer = useCallback((playerId) => {
        setDisplayPlayerIds((prev) => {
            if (prev.includes(playerId)) {
                const next = prev.filter((id) => id !== playerId);
                return next.length > 0 ? next : prev;
            }
            return [...prev, playerId];
        });
    }, []);

    const buildDeckFromCategoryIds = useCallback(
        (categoryIds) => buildDeckFromContentMap(categoryIds, section?.words),
        [section]
    );

    const getCategoryIds = useCallback(() => selectedCategories, [selectedCategories]);

    const getExtraStartFields = useCallback(() => ({
        displayMode,
        displayPlayerIds: displayMode === DISPLAY_MODE_SELECTED ? displayPlayerIds : [],
    }), [displayMode, displayPlayerIds]);

    const {
        roomData,
        deckLength,
        currentQuestion,
        currentIndex,
        startGame,
        forceResetTable,
        nextQuestion,
        prevQuestion,
        isLastQuestion,
        isFirstQuestion,
    } = useShuffledQuestionDeck(roomId, {
        buildDeckFromCategoryIds,
        getCategoryIds,
        getExtraStartFields,
        additionalState: {
            displayMode: DISPLAY_MODE_ALL,
            displayPlayerIds: [],
        },
        metricsGameId: 'sing-it',
    });

    const showsWord = useMemo(() => {
        if (!roomData.isGameStarted) return false;
        if (roomData.displayMode === DISPLAY_MODE_ALL) return true;
        return (roomData.displayPlayerIds || []).includes(myPlayerId);
    }, [roomData.displayMode, roomData.displayPlayerIds, roomData.isGameStarted, myPlayerId]);

    const displayPlayerNames = useMemo(() => {
        const ids = roomData.displayPlayerIds || [];
        return ids
            .map((id) => activePlayers.find((p) => p.id === id)?.name)
            .filter(Boolean);
    }, [activePlayers, roomData.displayPlayerIds]);

    const canStart = selectedCategories.length > 0
        && (displayMode === DISPLAY_MODE_ALL || displayPlayerIds.length > 0);

    return (
        <div className="sing-it-game">
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.sing-it.name')}>
                        <GameRulesList gameId="sing-it" />
                    </GameRules>

                    {!isHost ? (
                        <GameLobbyGuestWait gameId={gameId} />
                    ) : (
                        <>
                            <p>{t('gameLobby.selectCategories')}</p>

                            <CollapsibleSection
                                toggleLabel={t('gameSetup.singIt.settingsShow')}
                                toggleLabelOpen={t('gameSetup.singIt.settingsHide')}
                            >
                                <p className="sing-it-settings-lead">{t('gameSetup.singIt.displayModeTitle')}</p>
                                <SingItDisplayModeToggle
                                    mode={displayMode}
                                    onChange={setDisplayMode}
                                    t={t}
                                />
                                {displayMode === DISPLAY_MODE_SELECTED && (
                                    <>
                                        <p className="sing-it-settings-lead">{t('gameSetup.singIt.selectPhones')}</p>
                                        <SingItPlayerPicker
                                            players={activePlayers}
                                            selectedIds={displayPlayerIds}
                                            onToggle={toggleDisplayPlayer}
                                            t={t}
                                        />
                                    </>
                                )}
                            </CollapsibleSection>

                            <div className="sing-it-category-boxes">
                                <SingItCategoryBox
                                    title={t('gameSetup.singIt.wordsBoxTitle')}
                                    categories={wordCategories}
                                    selectedIds={selectedCategories}
                                    onToggle={toggleCategory}
                                />
                                <SingItCategoryBox
                                    title={t('gameSetup.singIt.artistsBoxTitle')}
                                    categories={artistCategories}
                                    selectedIds={selectedCategories}
                                    onToggle={toggleCategory}
                                />
                            </div>

                            <div className="lobby-start-actions actions-stack">
                                <button
                                    type="button"
                                    onClick={startGame}
                                    className="btn-accent btn-lobby-start"
                                    disabled={!canStart}
                                >
                                    {t('gameSetup.singIt.startButton')} ({selectedCategories.length})
                                </button>
                            </div>
                            <HostShareOptions shareOptions={shareOptions} />
                        </>
                    )}
                </div>
            ) : (
                <div>
                    <p className="nhie-progress-text">
                        {t('gameUi.wordProgress', { current: currentIndex + 1, total: deckLength })}
                    </p>

                    <p className="sing-it-hint">{t('gameUi.singItHint')}</p>

                    {showsWord ? (
                        <div className="content-panel content-panel--dark sing-it-word-panel">
                            {roomData.displayMode === DISPLAY_MODE_SELECTED ? (
                                <SingItOmniWord word={currentQuestion ?? t('common.loading')} />
                            ) : (
                                <h3 className="nhie-question-text sing-it-word-text">
                                    {currentQuestion ?? t('common.loading')}
                                </h3>
                            )}
                        </div>
                    ) : (
                        <div className="content-panel content-panel--dark sing-it-spectator-panel">
                            <p className="sing-it-spectator-title">{t('gameUi.singItSpectatorTitle')}</p>
                            <p className="sing-it-spectator-hint">
                                {displayPlayerNames.length > 0
                                    ? t('gameUi.singItSpectatorPhones', { names: displayPlayerNames.join(', ') })
                                    : t('gameUi.singItSpectatorGeneric')}
                            </p>
                            <p className="sing-it-spectator-mic">🎤</p>
                        </div>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            <div className="game-nav-row nhie-nav-buttons">
                                <button
                                    onClick={prevQuestion}
                                    disabled={isFirstQuestion}
                                    className={`btn-nhie-prev ${isFirstQuestion ? 'disabled' : ''}`}
                                >
                                    {t('gameUi.undo')}
                                </button>
                                <button
                                    onClick={nextQuestion}
                                    disabled={isLastQuestion}
                                    className="btn-nhie-next"
                                >
                                    {isLastQuestion ? t('gameUi.endGame') : t('gameUi.next')}
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

export default SingIt;
