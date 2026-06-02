import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref } from 'firebase/database';
import { get, set, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { useRtdbSync } from '../../lib/useRtdbSync';
import { useLocale } from '../../locales/LocaleContext';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';
import {
    DEFAULT_TELEPATHY_GAME_STATE,
    TELEPATHY_PHASE_REVEALED,
    TELEPATHY_PHASE_SUBMITTING,
    TELEPATHY_PHASE_WON,
    buildTelepathyAdvanceRoundUpdates,
    buildTelepathyStartUpdates,
    buildTelepathySyncUpdates,
    fetchAndRevealTelepathyRound,
    shouldPauseForTelepathyNextRound,
} from '../../lib/telepathyState';
import {
    TELEPATHY_AUTO_ROUND_DELAY_MS,
    allPlayersSubmitted,
    allWordsMatch,
    getTelepathyBoardRow,
    isTelepathyAutoRoundEnabled,
    isWordAlreadyUsed,
    normalizeTelepathyWord,
} from './telepathyUtils';

function TelepathyRevealItem({
    name,
    current,
    previous,
    currentHidden = false,
    currentPending = false,
    hiddenLabel = '?',
}) {
    let currentDisplay = current || '—';
    let currentClass = 'telepathy-reveal-word';
    if (currentHidden) {
        currentDisplay = hiddenLabel;
        currentClass += ' telepathy-reveal-word--hidden';
    } else if (currentPending) {
        currentDisplay = '—';
        currentClass += ' telepathy-reveal-word--pending';
    }

    return (
        <li className="telepathy-reveal-item">
            <span className="telepathy-reveal-name">{name}</span>
            <div className="telepathy-reveal-words">
                {previous.map((word, index) => (
                    <span
                        key={`${word}-${index}`}
                        className="telepathy-reveal-past"
                        title={word}
                    >
                        {word}
                    </span>
                ))}
                <span className={currentClass}>{currentDisplay}</span>
            </div>
        </li>
    );
}

function TelepathyPlayersBoard({
    participants,
    playerWordHistory,
    revealedWords,
    phase,
    submitted,
    hiddenLabel,
}) {
    return (
        <ul className="telepathy-reveal-list">
            {participants.map((player) => {
                const row = getTelepathyBoardRow(
                    playerWordHistory,
                    revealedWords,
                    player.id,
                    phase,
                    submitted
                );
                return (
                    <TelepathyRevealItem
                        key={player.id}
                        name={player.name}
                        current={row.current}
                        previous={row.previous}
                        currentHidden={row.currentHidden}
                        currentPending={row.currentPending}
                        hiddenLabel={hiddenLabel}
                    />
                );
            })}
        </ul>
    );
}

function TelepathyAutoRoundToggle({ autoRound, onToggle, t }) {
    return (
        <button
            type="button"
            className="settings-toggle telepathy-auto-toggle"
            onClick={onToggle}
            aria-pressed={autoRound}
        >
            <span className="telepathy-auto-toggle__text">
                <strong>{t('gameSetup.telepathy.autoRound')}</strong>
                <span className="telepathy-auto-toggle__hint">
                    {autoRound
                        ? t('gameSetup.telepathy.autoRoundOn')
                        : t('gameSetup.telepathy.autoRoundOff')}
                </span>
            </span>
            <span className={`settings-toggle__icon ${autoRound ? 'on' : 'off'}`}>
                {autoRound ? '✔' : '✕'}
            </span>
        </button>
    );
}

function TelepathyPlayerForm({
    label,
    playerId,
    disabled,
    usedWords,
    onSubmit,
    busy,
    t,
}) {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = useCallback(async () => {
        const trimmed = value.trim();
        const normalized = normalizeTelepathyWord(trimmed);
        if (!normalized) {
            setError(t('gameUi.telepathyEmptyWord'));
            return;
        }
        if (isWordAlreadyUsed(normalized, usedWords)) {
            setError(t('gameUi.telepathyWordUsed'));
            return;
        }
        setError('');
        const ok = await onSubmit(playerId, trimmed);
        if (ok) {
            setValue('');
        }
    }, [value, usedWords, onSubmit, playerId, t]);

    if (disabled) {
        return (
            <div className="telepathy-player-form telepathy-player-form--submitted">
                <p className="telepathy-player-form__label">{label}</p>
                <p className="telepathy-submitted-msg">{t('gameUi.telepathyWordSaved')}</p>
            </div>
        );
    }

    return (
        <div className="telepathy-player-form">
            <label className="telepathy-player-form__label" htmlFor={`telepathy-${playerId}`}>
                {label}
            </label>
            <div className="telepathy-player-form__row">
                <input
                    id={`telepathy-${playerId}`}
                    type="text"
                    className="telepathy-input"
                    value={value}
                    disabled={disabled || busy}
                    maxLength={48}
                    autoComplete="off"
                    onChange={(e) => {
                        setValue(e.target.value);
                        if (error) setError('');
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSubmit();
                        }
                    }}
                />
                <button
                    type="button"
                    className="btn-main-action telepathy-submit-btn"
                    disabled={disabled || busy}
                    onClick={() => void handleSubmit()}
                >
                    {t('gameUi.telepathySubmit')}
                </button>
            </div>
            {error ? <p className="telepathy-error">{error}</p> : null}
        </div>
    );
}

function Telepathy({
    isHost,
    hasAdminPowers = false,
    onLeave,
    myPlayerId,
    tablePlayers = [],
    roomId,
    shareOptions,
}) {
    const { t } = useLocale();
    const { rtdbBusy, syncOpts } = useRtdbSync();
    const roomData = useRoomGameState(roomId, DEFAULT_TELEPATHY_GAME_STATE, { mergeDefaults: true });
    usePiGameSession(roomData.isGameStarted);

    const [lobbyAutoRound, setLobbyAutoRound] = useState(true);
    const autoRound = roomData.isGameStarted
        ? isTelepathyAutoRoundEnabled(roomData)
        : lobbyAutoRound;
    const autoRoundCountdownRef = useRef(null);
    const [autoRoundSecondsLeft, setAutoRoundSecondsLeft] = useState(0);

    const participants = useMemo(
        () => getTablePlayers(tablePlayers).map((p) => ({ id: p.id, name: p.name })),
        [tablePlayers]
    );
    const participantIds = useMemo(
        () => participants.map((p) => p.id),
        [participants]
    );

    const participantsFingerprint = useMemo(
        () => [...participantIds].sort().join(','),
        [participantIds]
    );

    const myGuests = useMemo(
        () => getGuestsForOwner(tablePlayers, myPlayerId).map((g) => ({ id: g.id, name: g.name })),
        [tablePlayers, myPlayerId]
    );

    const playersICanSubmitFor = useMemo(() => {
        const list = [];
        const me = participants.find((p) => p.id === myPlayerId);
        if (me) list.push(me);
        return [...list, ...myGuests];
    }, [participants, myPlayerId, myGuests]);

    const submitted = roomData.submitted || {};
    const usedWords = roomData.usedWords || [];
    const phase = roomData.phase;
    const isSubmitting = phase === TELEPATHY_PHASE_SUBMITTING;
    const isWon = phase === TELEPATHY_PHASE_WON;
    const isRevealed = phase === TELEPATHY_PHASE_REVEALED;
    const showRevealScreen = isRevealed || isWon;
    const revealedWords = roomData.revealedWords || {};
    const playerWordHistory = roomData.playerWordHistory || {};
    const roundNumber = roomData.roundNumber || 0;

    const iAmFullySubmitted = useMemo(
        () => playersICanSubmitFor.every((p) => submitted[p.id] === true),
        [playersICanSubmitFor, submitted]
    );

    const everyoneSubmitted = useMemo(
        () => allPlayersSubmitted(participantIds, submitted),
        [participantIds, submitted]
    );

    const matched = useMemo(
        () =>
            isWon
            || (isRevealed && allWordsMatch(revealedWords, participantIds)),
        [isWon, isRevealed, revealedWords, participantIds]
    );

    const needsRoundApproval = useMemo(
        () => shouldPauseForTelepathyNextRound(roomData),
        [roomData]
    );

    const canConfirmNextRound = showRevealScreen && !isWon && needsRoundApproval;
    const canPressNextRound = canConfirmNextRound && (isHost || hasAdminPowers);

    const startGame = useCallback(async () => {
        await update(
            ref(db),
            buildTelepathyStartUpdates(roomId, { autoRound: lobbyAutoRound }),
            syncOpts
        );
    }, [roomId, syncOpts, lobbyAutoRound]);

    const toggleAutoRound = useCallback(() => {
        if (!isHost) return;
        if (!roomData.isGameStarted) {
            setLobbyAutoRound((prev) => !prev);
            return;
        }
        void set(
            ref(db, `rooms/${roomId}/gameState/autoRound`),
            !isTelepathyAutoRoundEnabled(roomData),
            syncOpts
        );
    }, [isHost, roomData, roomId, syncOpts]);

    const forceResetTable = useCallback(async () => {
        await update(ref(db), { [`rooms/${roomId}/gameState`]: null, [`rooms/${roomId}/private`]: null }, syncOpts);
    }, [roomId, syncOpts]);

    const tryRevealRound = useCallback(async () => {
        const snap = await get(ref(db, `rooms/${roomId}/gameState/submitted`));
        const latestSubmitted = snap.val() || {};
        if (!allPlayersSubmitted(participantIds, latestSubmitted)) return false;

        const usedSnap = await get(ref(db, `rooms/${roomId}/gameState/usedWords`));
        const latestUsed = Array.isArray(usedSnap.val()) ? usedSnap.val() : [];

        const revealUpdates = await fetchAndRevealTelepathyRound(
            roomId,
            participantIds,
            latestUsed
        );
        await update(ref(db), revealUpdates, syncOpts);
        return true;
    }, [roomId, participantIds, syncOpts]);

    const submitWord = useCallback(
        async (playerId, rawWord) => {
            const trimmed = rawWord.trim();
            const normalized = normalizeTelepathyWord(trimmed);
            if (!normalized || isWordAlreadyUsed(normalized, usedWords)) return false;

            const submittedSnap = await get(ref(db, `rooms/${roomId}/gameState/submitted/${playerId}`));
            if (submittedSnap.val() === true) return true;

            await update(
                ref(db),
                {
                    [`rooms/${roomId}/private/${playerId}/telepathyWord`]: trimmed,
                    [`rooms/${roomId}/gameState/submitted/${playerId}`]: true,
                },
                syncOpts
            );

            const afterSnap = await get(ref(db, `rooms/${roomId}/gameState/submitted`));
            if (allPlayersSubmitted(participantIds, afterSnap.val() || {})) {
                await tryRevealRound();
            }
            return true;
        },
        [roomId, usedWords, syncOpts, participantIds, tryRevealRound]
    );

    const nextRound = useCallback(async () => {
        if (phase === TELEPATHY_PHASE_WON) return;
        const next = (roundNumber || 1) + 1;
        await update(
            ref(db),
            buildTelepathyAdvanceRoundUpdates(roomId, next, participantIds),
            syncOpts
        );
    }, [roomId, roundNumber, participantIds, syncOpts, phase]);

    useEffect(() => {
        if (!isRevealed || isWon || !autoRound || !isHost) {
            setAutoRoundSecondsLeft(0);
            return undefined;
        }

        const endsAt = Date.now() + TELEPATHY_AUTO_ROUND_DELAY_MS;
        setAutoRoundSecondsLeft(Math.ceil(TELEPATHY_AUTO_ROUND_DELAY_MS / 1000));

        autoRoundCountdownRef.current = window.setInterval(() => {
            const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            setAutoRoundSecondsLeft(left);
        }, 250);

        const timer = window.setTimeout(() => {
            void nextRound();
        }, TELEPATHY_AUTO_ROUND_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
            if (autoRoundCountdownRef.current) {
                window.clearInterval(autoRoundCountdownRef.current);
                autoRoundCountdownRef.current = null;
            }
            setAutoRoundSecondsLeft(0);
        };
    }, [isRevealed, isWon, autoRound, isHost, roundNumber, nextRound]);

    useEffect(() => {
        if (!isHost || !isSubmitting || !roomId) return undefined;

        let cancelled = false;
        void (async () => {
            try {
                const { updates } = await buildTelepathySyncUpdates(roomId);
                if (cancelled || Object.keys(updates).length === 0) return;
                await update(ref(db), updates, syncOpts);
            } catch (err) {
                console.warn('[telepathy] auto sync:', err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [participantsFingerprint, isHost, isSubmitting, roomId, syncOpts]);

    const handleEndGame = useCallback(async () => {
        await forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const pendingCount = participantIds.filter((id) => submitted[id] !== true).length;

    return (
        <div className="telepathy-game">
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.telepathy.name')}>
                        <GameRulesList gameId="telepathy" />
                    </GameRules>

                    {isHost ? (
                        <div className="telepathy-lobby-actions">
                            <TelepathyAutoRoundToggle
                                autoRound={autoRound}
                                onToggle={toggleAutoRound}
                                t={t}
                            />
                            <button type="button" className="btn-main-action" onClick={() => void startGame()}>
                                {t('gameLobby.startGame')}
                            </button>
                            <HostShareOptions shareOptions={shareOptions} />
                        </div>
                    ) : (
                        <p className="telepathy-wait-host">{t('gameLobby.waitForHostTelepathy')}</p>
                    )}
                </div>
            ) : (
                <div>
                    <p className="telepathy-round-text">
                        {t('gameUi.telepathyRound', { round: roundNumber })}
                    </p>

                    {isHost && (
                        <div className="telepathy-live-settings">
                            <TelepathyAutoRoundToggle
                                autoRound={autoRound}
                                onToggle={toggleAutoRound}
                                t={t}
                            />
                        </div>
                    )}

                    {usedWords.length > 0 && (
                        <div className="telepathy-used-words content-panel content-panel--dark">
                            <p className="telepathy-used-words__title">{t('gameUi.telepathyUsedWords')}</p>
                            <p className="telepathy-used-words__list">
                                {usedWords.join(', ')}
                            </p>
                        </div>
                    )}

                    <TelepathyPlayersBoard
                        participants={participants}
                        playerWordHistory={playerWordHistory}
                        revealedWords={revealedWords}
                        phase={phase}
                        submitted={submitted}
                        hiddenLabel={t('gameUi.telepathyHiddenWord')}
                    />

                    {isSubmitting && (
                        <>
                            <p className="telepathy-hint">{t('gameUi.telepathyHint')}</p>
                            <p className="telepathy-status">
                                {t('gameUi.telepathyPending', { count: pendingCount })}
                            </p>

                            {playersICanSubmitFor.map((player) => {
                                const already = submitted[player.id] === true;
                                const isMe = player.id === myPlayerId;
                                const label = isMe
                                    ? t('gameUi.telepathyYourWord')
                                    : t('gameUi.telepathyGuestWord', { name: player.name });
                                return (
                                    <TelepathyPlayerForm
                                        key={player.id}
                                        label={label}
                                        playerId={player.id}
                                        disabled={already}
                                        usedWords={usedWords}
                                        onSubmit={submitWord}
                                        busy={rtdbBusy}
                                        t={t}
                                    />
                                );
                            })}

                            {playersICanSubmitFor.length === 0 && (
                                <p className="telepathy-wait-host">{t('gameUi.telepathySpectator')}</p>
                            )}

                            {iAmFullySubmitted && !everyoneSubmitted && (
                                <p className="telepathy-wait-others">{t('gameUi.telepathyWaitOthers')}</p>
                            )}

                            {isHost && (
                                <div className="game-host-controls telepathy-host-settings">
                                    <HostShareOptions shareOptions={shareOptions} />
                                </div>
                            )}
                        </>
                    )}

                    {showRevealScreen && (
                        <>
                            <div
                                className={`telepathy-result-banner ${matched ? 'telepathy-result-banner--win' : 'telepathy-result-banner--miss'}`}
                            >
                                {matched
                                    ? t('gameUi.telepathyAllMatch')
                                    : t('gameUi.telepathyNoMatch')}
                            </div>

                            {isWon && (
                                <p className="telepathy-game-over">{t('gameUi.telepathyGameOver')}</p>
                            )}

                            {!isWon && autoRound && autoRoundSecondsLeft > 0 && (
                                <p className="telepathy-auto-countdown">
                                    {t('gameUi.telepathyAutoCountdown', { seconds: autoRoundSecondsLeft })}
                                </p>
                            )}

                            {canConfirmNextRound && !canPressNextRound && (
                                <p className="telepathy-round-review-wait">
                                    {t('gameUi.telepathyRoundReviewWait')}
                                </p>
                            )}

                            {isHost && (
                                <div className="game-host-controls">
                                    <HostShareOptions shareOptions={shareOptions} />
                                    <ConfirmButton onClick={() => void forceResetTable()} text={t('gameUi.resetTable')} />
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {canPressNextRound && (
                <div className="telepathy-round-review-bar">
                    <p className="telepathy-round-review-bar__hint">
                        {t('gameUi.telepathyRoundReviewHint')}
                    </p>
                    <button
                        type="button"
                        className="btn-main-action telepathy-round-review-bar__btn"
                        disabled={rtdbBusy}
                        onClick={() => void nextRound()}
                    >
                        {t('gameUi.telepathyStartNextRound')}
                    </button>
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={isHost ? () => void handleEndGame() : onLeave}
                    text={isHost ? t('gameUi.closeRoom') : t('gameUi.leaveRoom')}
                />
            </div>
        </div>
    );
}

export default Telepathy;
