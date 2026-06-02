import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref } from 'firebase/database';
import { get, set, update, isRtdbPermissionDenied } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import impostorFallback from '../../data/games/impostor.json';
import { getCategoryLabel, getImpostorCategories } from '../../lib/gameContentUtils';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { useRtdbSync } from '../../lib/useRtdbSync';
import { useLocale } from '../../locales/LocaleContext';
import {
    usePrivateRolesForPlayers,
    getPrivateWord,
} from '../../lib/usePrivateGameState';
import { useCategorySelection } from '../../lib/useCategorySelection';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import SharedPhoneRoleReveal from '../../components/SharedPhoneRoleReveal';
import { HostShareOptions } from '../../components/RoomInviteQR';
import CollapsibleSection from '../../components/CollapsibleSection';
import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';
import {
    DEFAULT_JUST_ONE_GAME_STATE,
    JUST_ONE_PHASE_PEEKING,
    JUST_ONE_PHASE_SUBMITTING,
    JUST_ONE_PHASE_WON,
    buildJustOnePrivateWordPathUpdates,
    buildJustOneStartUpdates,
    buildJustOneWonUpdates,
    buildJustOneStartSubmittingUpdates,
    buildJustOneReplayWordUpdates,
    buildJustOneSyncUpdates,
    tryAdvanceJustOneIfReady,
} from '../../lib/justOneState';
import {
    allClueGiversSubmitted,
    getJustOnePendingClueGiverNames,
    buildJustOneListenerClueGrid,
    getJustOneListenerRounds,
    getJustOneUsedClueLabels,
    isJustOneClueForbidden,
    pickDifferentListener,
    pickSecretWord,
    normalizeJustOneWord,
    resolveJustOneClueGivers,
} from './justOneUtils';

function JustOneAutoRoundToggle({ autoRound, onToggle, t }) {
    return (
        <button
            type="button"
            className="settings-toggle telepathy-auto-toggle"
            onClick={onToggle}
            aria-pressed={autoRound}
        >
            <span className="telepathy-auto-toggle__text">
                <strong>{t('gameSetup.justOne.autoRound')}</strong>
                <span className="telepathy-auto-toggle__hint">
                    {autoRound
                        ? t('gameSetup.justOne.autoRoundOn')
                        : t('gameSetup.justOne.autoRoundOff')}
                </span>
            </span>
            <span className={`settings-toggle__icon ${autoRound ? 'on' : 'off'}`}>
                {autoRound ? '✔' : '✕'}
            </span>
        </button>
    );
}

function formatJustOneClueCell(entry, t, showDuplicateWord = false) {
    if (!entry) {
        return { className: 'just-one-clues-table__clue just-one-clues-table__clue--empty', content: '—' };
    }
    if (entry.isDuplicate) {
        const content = showDuplicateWord && entry.raw
            ? entry.raw
            : t('gameUi.justOneDuplicate');
        return {
            className: 'just-one-clues-table__clue just-one-clues-table__clue--dup',
            content,
            isDuplicate: true,
        };
    }
    if (entry.visible) {
        return {
            className: 'just-one-clues-table__clue just-one-clues-table__clue--ok',
            content: entry.visible,
        };
    }
    return { className: 'just-one-clues-table__clue just-one-clues-table__clue--empty', content: '—' };
}

/**
 * @param {{ entries: Array<{ playerId: string, raw?: string, visible?: string | null, isDuplicate?: boolean }>, getPlayerName: (id: string) => string, t: (key: string, vars?: object) => string, showDuplicateWord?: boolean }} props
 */
function JustOneCluesTable({ entries, getPlayerName, t, showDuplicateWord = false }) {
    if (!entries.length) return null;

    return (
        <div className="just-one-clues-table-wrap">
            <table className="just-one-clues-table">
                <thead>
                    <tr>
                        <th scope="col">{t('gameUi.justOneClueColPlayer')}</th>
                        <th scope="col">{t('gameUi.justOneClueColWord')}</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map((entry) => {
                        const name = getPlayerName(entry.playerId) || '—';
                        const cell = formatJustOneClueCell(entry, t, showDuplicateWord);

                        return (
                            <tr
                                key={entry.playerId}
                                className={entry.isDuplicate ? 'just-one-clues-table__row--dup' : undefined}
                            >
                                <th scope="row" className="just-one-clues-table__player">
                                    {name}
                                </th>
                                <td className={cell.className}>
                                    {cell.isDuplicate && !showDuplicateWord ? (
                                        <span title={t('gameUi.justOneDuplicateTitle')}>{cell.content}</span>
                                    ) : (
                                        cell.content
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/**
 * @param {{ grid: ReturnType<typeof buildJustOneListenerClueGrid>, getPlayerName: (id: string) => string, t: (key: string, vars?: object) => string, currentRound: number }} props
 */
function JustOneListenerCluesBoard({ grid, getPlayerName, t, currentRound }) {
    const { playerIds, rounds, cellByKey } = grid;
    if (!playerIds.length || !rounds.length) return null;

    const latestRound = rounds[rounds.length - 1] ?? 0;

    return (
        <div className="just-one-listener-board">
            <p className="just-one-listener-board__current-round">
                {t('gameUi.justOneCurrentRound', { round: currentRound })}
            </p>
            <div className="just-one-listener-board__players">
                {playerIds.map((playerId) => (
                    <section key={playerId} className="just-one-listener-card">
                        <h3 className="just-one-listener-card__name">{getPlayerName(playerId) || '—'}</h3>
                        <div className="just-one-listener-card__chips">
                            {rounds.map((round) => {
                                const entry = cellByKey.get(`${playerId}:${round}`);
                                const cell = formatJustOneClueCell(entry, t);
                                const isCurrent = round === currentRound;
                                const isLatest = round === latestRound;
                                const chipClass = [
                                    'just-one-listener-chip',
                                    cell.isDuplicate ? 'just-one-listener-chip--dup' : '',
                                    isCurrent ? 'just-one-listener-chip--current' : '',
                                    !isCurrent && isLatest ? 'just-one-listener-chip--latest' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ');
                                const tooltip = `${t('gameUi.justOneListenerRoundSection', { round })}: ${cell.content}`;

                                return (
                                    <div key={round} className={chipClass} title={tooltip}>
                                        <span className="just-one-listener-chip__round">
                                            {t('gameUi.justOneClueColRound', { round })}
                                        </span>
                                        <span className="just-one-listener-chip__word">
                                            {cell.isDuplicate ? (
                                                <span title={t('gameUi.justOneDuplicateTitle')}>{cell.content}</span>
                                            ) : (
                                                cell.content
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

function JustOneClueForm({ label, playerId, disabled, clueHistory, onSubmit, busy, t }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = useCallback(async () => {
        const trimmed = value.trim();
        if (!normalizeJustOneWord(trimmed)) {
            setError(t('gameUi.justOneEmptyWord'));
            return;
        }
        if (isJustOneClueForbidden(clueHistory, trimmed)) {
            setError(t('gameUi.justOneClueUsed'));
            return;
        }
        setError('');
        const ok = await onSubmit(playerId, trimmed);
        if (ok) setValue('');
    }, [value, clueHistory, onSubmit, playerId, t]);

    if (disabled) {
        return (
            <div className="telepathy-player-form telepathy-player-form--submitted">
                <p className="telepathy-player-form__label">{label}</p>
                <p className="telepathy-submitted-msg">{t('gameUi.justOneClueSaved')}</p>
            </div>
        );
    }

    return (
        <div className="telepathy-player-form">
            <label className="telepathy-player-form__label" htmlFor={`just-one-${playerId}`}>
                {label}
            </label>
            <div className="telepathy-player-form__row">
                <input
                    id={`just-one-${playerId}`}
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
                    {t('gameUi.justOneSubmit')}
                </button>
            </div>
            {error ? <p className="telepathy-error">{error}</p> : null}
        </div>
    );
}

function JustOne({
    isHost,
    hasAdminPowers = false,
    onLeave,
    myPlayerId,
    tablePlayers = [],
    roomId,
    shareOptions,
}) {
    const { gameContent, t } = useLocale();
    const impostorSection = gameContent.impostor ?? impostorFallback;
    const playableCategories = useMemo(
        () => getImpostorCategories(impostorSection),
        [impostorSection]
    );
    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
    } = useCategorySelection(playableCategories);

    const { rtdbBusy, syncOpts } = useRtdbSync();
    const roomData = useRoomGameState(roomId, DEFAULT_JUST_ONE_GAME_STATE, { mergeDefaults: true });
    usePiGameSession(roomData.isGameStarted);

    const [lobbyAutoRound, setLobbyAutoRound] = useState(true);
    const [startErrorKey, setStartErrorKey] = useState('');
    const [showRole, setShowRole] = useState(false);
    const roleRevealEpoch = roomData.roleRevealEpoch ?? 0;
    const autoRound = roomData.isGameStarted
        ? roomData.autoRound !== false
        : lobbyAutoRound;

    const tablePlayersList = useMemo(() => getTablePlayers(tablePlayers), [tablePlayers]);
    const lobbyPlayerCount = tablePlayersList.length;
    const participants = useMemo(
        () => tablePlayersList.map((p) => ({ id: p.id, name: p.name })),
        [tablePlayersList]
    );
    const participantIds = useMemo(() => participants.map((p) => p.id), [participants]);
    const participantsFingerprint = useMemo(
        () => [...participantIds].sort().join(','),
        [participantIds]
    );

    const { listenerId, clueGiverIds } = useMemo(
        () => resolveJustOneClueGivers(
            participantIds,
            roomData.listenerId,
            roomData.previousListenerId
        ),
        [participantIds, roomData.listenerId, roomData.previousListenerId]
    );

    const listener = useMemo(
        () => participants.find((p) => p.id === listenerId),
        [participants, listenerId]
    );

    const listenerOutOfSync = Boolean(
        roomData.listenerId && listenerId && roomData.listenerId !== listenerId
    );

    const clueGivers = useMemo(
        () => participants.filter((p) => clueGiverIds.includes(p.id)),
        [participants, clueGiverIds]
    );

    const iAmListener = myPlayerId === listenerId;
    const iAmClueGiver = clueGiverIds.includes(myPlayerId);
    const myGuests = useMemo(
        () => getGuestsForOwner(tablePlayers, myPlayerId).map((g) => ({ id: g.id, name: g.name })),
        [tablePlayers, myPlayerId]
    );
    const clueGiverGuests = useMemo(
        () => myGuests.filter((g) => clueGiverIds.includes(g.id)),
        [myGuests, clueGiverIds]
    );

    const linkedPlayerIds = useMemo(
        () => [myPlayerId, ...myGuests.map((g) => g.id)].filter(Boolean),
        [myPlayerId, myGuests]
    );
    const privateRoles = usePrivateRolesForPlayers(
        roomData.isGameStarted ? roomId : null,
        roomData.isGameStarted ? linkedPlayerIds : []
    );
    const myDisplayWord = getPrivateWord(privateRoles[myPlayerId]);

    const playersICanSubmitFor = useMemo(() => {
        if (iAmListener) return [];
        const list = [];
        const me = clueGivers.find((p) => p.id === myPlayerId);
        if (me) list.push(me);
        const guestClueGivers = myGuests.filter((g) => clueGiverIds.includes(g.id));
        return [...list, ...guestClueGivers];
    }, [iAmListener, clueGivers, myPlayerId, myGuests, clueGiverIds]);

    const submitted = roomData.submitted || {};
    const submittedFingerprint = useMemo(() => JSON.stringify(submitted), [submitted]);

    const advanceInFlightRef = useRef(false);
    const quickResetInFlightRef = useRef(false);
    const handledWonRoundRef = useRef(null);
    const phase = roomData.phase;
    const isPeeking = phase === JUST_ONE_PHASE_PEEKING;
    const isSubmitting = phase === JUST_ONE_PHASE_SUBMITTING;
    const isWon = phase === JUST_ONE_PHASE_WON;
    const roundNumber = roomData.roundNumber || 0;
    const clueHistory = roomData.clueHistory || [];

    const usedClueLabels = useMemo(
        () => getJustOneUsedClueLabels(clueHistory),
        [clueHistory]
    );

    const listenerRounds = useMemo(
        () => getJustOneListenerRounds(clueHistory, clueGiverIds),
        [clueHistory, clueGiverIds]
    );

    const listenerClueGrid = useMemo(
        () => buildJustOneListenerClueGrid(listenerRounds),
        [listenerRounds]
    );

    const listenerNameById = useMemo(
        () => new Map(participants.map((p) => [p.id, p.name])),
        [participants]
    );

    const lastRoundReview = useMemo(
        () => (listenerRounds.length > 0 ? listenerRounds[listenerRounds.length - 1] : null),
        [listenerRounds]
    );

    const iAmFullySubmitted = useMemo(
        () =>
            playersICanSubmitFor.length > 0
            && playersICanSubmitFor.every((p) => submitted[p.id] === true),
        [playersICanSubmitFor, submitted]
    );

    const everyoneSubmitted = useMemo(
        () => allClueGiversSubmitted(clueGiverIds, submitted, tablePlayersList, listenerId),
        [clueGiverIds, submitted, tablePlayersList, listenerId]
    );

    const pendingNames = useMemo(
        () => getJustOnePendingClueGiverNames(tablePlayersList, clueGiverIds, listenerId, submitted),
        [tablePlayersList, clueGiverIds, listenerId, submitted]
    );

    const pendingCount = useMemo(() => {
        if (!pendingNames.trim()) return 0;
        return pendingNames.split(', ').length;
    }, [pendingNames]);

    const canMarkGuessed = isSubmitting && !isWon && (isHost || hasAdminPowers || iAmListener);

    const startGame = useCallback(async () => {
        setStartErrorKey('');
        if (selectedCategories.length === 0) {
            setStartErrorKey('gameSetup.justOne.needCategory');
            return;
        }

        const wordsByCategory = impostorSection?.words ?? {};
        const categoryIds = selectedCategories.filter(
            (id) => Array.isArray(wordsByCategory[id]) && wordsByCategory[id].length > 0
        );
        if (categoryIds.length === 0) {
            setStartErrorKey('gameSetup.justOne.startFailed');
            return;
        }

        const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
        const playersData = playersSnap.val();
        if (!playersData) {
            setStartErrorKey('gameSetup.justOne.needPlayers');
            return;
        }

        const playerIds = Object.keys(playersData);
        if (playerIds.length < 3) {
            setStartErrorKey('gameSetup.justOne.needPlayers');
            return;
        }

        const picked = pickSecretWord(wordsByCategory, categoryIds);
        if (!picked) {
            setStartErrorKey('gameSetup.justOne.startFailed');
            return;
        }

        const listenerPick = pickDifferentListener(playerIds, null);
        if (!listenerPick) {
            setStartErrorKey('gameSetup.justOne.startFailed');
            return;
        }

        const catNameDisplay = getCategoryLabel(playableCategories, picked.chosenCatId);

        try {
            await update(
                ref(db),
                buildJustOneStartUpdates(
                    roomId,
                    {
                        roundNumber: 1,
                        listenerId: listenerPick,
                        previousListenerId: listenerPick,
                        categoryName: catNameDisplay,
                        categoryIds,
                        autoRound: lobbyAutoRound,
                    },
                    {
                        word: picked.randomWord,
                        chosenCatId: picked.chosenCatId,
                        playerIds,
                        listenerId: listenerPick,
                    }
                ),
                syncOpts
            );
        } catch (err) {
            console.error('[just-one] startGame', err);
            setStartErrorKey(
                isRtdbPermissionDenied(err)
                    ? 'gameSetup.impostor.startErrorPermission'
                    : 'gameSetup.justOne.startFailed'
            );
        }
    }, [
        selectedCategories,
        impostorSection,
        playableCategories,
        roomId,
        syncOpts,
        lobbyAutoRound,
    ]);

    const canStartLobby =
        selectedCategories.length > 0 && lobbyPlayerCount >= 3;

    const toggleAutoRound = useCallback(() => {
        if (!isHost) return;
        if (!roomData.isGameStarted) {
            setLobbyAutoRound((prev) => !prev);
            return;
        }
        void set(
            ref(db, `rooms/${roomId}/gameState/autoRound`),
            !(roomData.autoRound !== false),
            syncOpts
        );
    }, [isHost, roomData, roomId, syncOpts]);

    const forceResetTable = useCallback(async () => {
        await update(
            ref(db),
            { [`rooms/${roomId}/gameState`]: null, [`rooms/${roomId}/private`]: null, [`rooms/${roomId}/hostOnly`]: null },
            syncOpts
        );
    }, [roomId, syncOpts]);

    const tryAdvanceJustOneRound = useCallback(
        async (assumeSubmittedId) => {
            if (!isHost || advanceInFlightRef.current) return;
            advanceInFlightRef.current = true;

            try {
                await tryAdvanceJustOneIfReady(roomId, { assumeSubmittedId });
            } catch (err) {
                console.warn('[just-one] advance:', err);
            } finally {
                advanceInFlightRef.current = false;
            }
        },
        [isHost, roomId]
    );

    const submitClue = useCallback(
        async (playerId, rawWord) => {
            const trimmed = rawWord.trim();
            if (!normalizeJustOneWord(trimmed)) return false;
            if (isJustOneClueForbidden(clueHistory, trimmed)) return false;

            const submittedSnap = await get(ref(db, `rooms/${roomId}/gameState/submitted/${playerId}`));
            if (submittedSnap.val() === true) return true;

            await update(
                ref(db),
                {
                    [`rooms/${roomId}/private/${playerId}/justOneClue`]: trimmed,
                    [`rooms/${roomId}/gameState/submitted/${playerId}`]: true,
                },
                syncOpts
            );

            if (isHost) {
                await tryAdvanceJustOneRound(playerId);
            }
            return true;
        },
        [roomId, syncOpts, isHost, tryAdvanceJustOneRound, clueHistory]
    );

    const markGuessed = useCallback(async () => {
        await update(ref(db), buildJustOneWonUpdates(roomId), syncOpts);
    }, [roomId, syncOpts]);

    const quickResetWordAndRoles = useCallback(async () => {
        if (!isHost || quickResetInFlightRef.current) return false;
        quickResetInFlightRef.current = true;
        try {
            const categoryIdsRaw = Array.isArray(roomData.categoryIds) ? roomData.categoryIds : [];
            const wordsByCategory = impostorSection?.words ?? {};
            const categoryIds = categoryIdsRaw.filter(
                (id) => Array.isArray(wordsByCategory[id]) && wordsByCategory[id].length > 0
            );
            if (!categoryIds.length) return false;

            if (participantIds.length < 3) return false;

            const hostWordSnap = await get(ref(db, `rooms/${roomId}/hostOnly/word`));
            const previousWord = typeof hostWordSnap.val() === 'string' ? hostWordSnap.val() : '';
            const picked = pickSecretWord(wordsByCategory, categoryIds, previousWord);
            if (!picked) return false;

            const listenerPick = pickDifferentListener(
                participantIds,
                roomData.previousListenerId ?? roomData.listenerId ?? null
            );
            if (!listenerPick) return false;

            const catNameDisplay = getCategoryLabel(playableCategories, picked.chosenCatId);
            const nextRound = Math.max(1, (Number(roomData.roundNumber) || 0) + 1);
            const nextEpoch = (Number(roomData.roleRevealEpoch) || 1) + 1;

            const updates = {
                [`rooms/${roomId}/gameState/isGameStarted`]: true,
                [`rooms/${roomId}/gameState/phase`]: JUST_ONE_PHASE_PEEKING,
                [`rooms/${roomId}/gameState/roundNumber`]: nextRound,
                [`rooms/${roomId}/gameState/listenerId`]: listenerPick,
                [`rooms/${roomId}/gameState/previousListenerId`]: listenerPick,
                [`rooms/${roomId}/gameState/roleRevealEpoch`]: nextEpoch,
                [`rooms/${roomId}/gameState/categoryName`]: catNameDisplay,
                [`rooms/${roomId}/gameState/categoryIds`]: categoryIds,
                [`rooms/${roomId}/gameState/submitted`]: {},
                [`rooms/${roomId}/gameState/clueHistory`]: [],
                [`rooms/${roomId}/gameState/currentClues`]: null,
                [`rooms/${roomId}/gameState/visibleClues`]: null,
                [`rooms/${roomId}/gameState/awaitingNextRound`]: false,
                [`rooms/${roomId}/hostOnly/word`]: picked.randomWord,
                [`rooms/${roomId}/hostOnly/chosenCatId`]: picked.chosenCatId,
                ...buildJustOnePrivateWordPathUpdates(roomId, participantIds, listenerPick, picked.randomWord),
            };

            await update(ref(db), updates, syncOpts);
            return true;
        } catch (err) {
            console.warn('[just-one] quick reset:', err);
            return false;
        } finally {
            quickResetInFlightRef.current = false;
        }
    }, [
        isHost,
        roomData.categoryIds,
        roomData.previousListenerId,
        roomData.listenerId,
        roomData.roundNumber,
        roomData.roleRevealEpoch,
        impostorSection,
        participantIds,
        roomId,
        playableCategories,
        syncOpts,
    ]);

    const startSubmittingPhase = useCallback(async () => {
        await update(
            ref(db),
            buildJustOneStartSubmittingUpdates(roomId, listenerId),
            syncOpts
        );
    }, [roomId, listenerId, syncOpts]);

    const replayWord = useCallback(async () => {
        const nextEpoch = (Number(roomData.roleRevealEpoch) || 1) + 1;
        await update(ref(db), buildJustOneReplayWordUpdates(roomId, nextEpoch), syncOpts);
    }, [roomData.roleRevealEpoch, roomId, syncOpts]);

    const renderWordReveal = useCallback(
        (word) => (
            <>
                <h2 className="impostor-role-title text-success">{word}</h2>
                <p className="impostor-cat-info">
                    {t('gameUi.justOneCategory')}:{' '}
                    <span className="text-gold">{roomData.categoryName}</span>
                </p>
            </>
        ),
        [roomData.categoryName, t]
    );

    const renderListenerPeek = useCallback(
        () => (
            <>
                <h2 className="impostor-role-title text-gold">{t('gameUi.justOneYouAreListener')}</h2>
                <p className="impostor-cat-info">
                    {t('gameUi.justOneCategory')}:{' '}
                    <span className="text-gold">{roomData.categoryName}</span>
                </p>
                <p className="impostor-secret-warning">{t('gameUi.justOneListenerPeekHint')}</p>
            </>
        ),
        [roomData.categoryName, t]
    );

    useEffect(() => {
        if (!isHost || !isSubmitting || !roomId) return undefined;

        let cancelled = false;

        void (async () => {
            try {
                const { updates, result } = await buildJustOneSyncUpdates(roomId);
                if (cancelled) return;
                if (Object.keys(updates).length > 0) {
                    await update(ref(db), updates, syncOpts);
                }
                if (!cancelled && result === 'ready_to_advance') {
                    await tryAdvanceJustOneRound();
                }
            } catch (err) {
                console.warn('[just-one] auto sync:', err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        participantsFingerprint,
        listenerId,
        submittedFingerprint,
        isHost,
        isSubmitting,
        roomId,
        syncOpts,
        tryAdvanceJustOneRound,
    ]);

    useEffect(() => {
        if (!isHost || !isSubmitting || !everyoneSubmitted || clueGiverIds.length === 0) {
            return undefined;
        }
        void tryAdvanceJustOneRound();
        return undefined;
    }, [
        isHost,
        isSubmitting,
        everyoneSubmitted,
        clueGiverIds.length,
        roundNumber,
        submittedFingerprint,
        tryAdvanceJustOneRound,
    ]);

    const handleEndGame = useCallback(async () => {
        await forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    useEffect(() => {
        if (!isHost || !listenerOutOfSync || !roomId || !roomData.isGameStarted) return undefined;
        void update(
            ref(db),
            {
                [`rooms/${roomId}/gameState/listenerId`]: listenerId,
                [`rooms/${roomId}/gameState/previousListenerId`]: listenerId,
            },
            syncOpts
        ).catch((err) => {
            console.warn('[just-one] listener sync:', err);
        });
        return undefined;
    }, [isHost, listenerOutOfSync, listenerId, roomId, roomData.isGameStarted, syncOpts]);

    useEffect(() => {
        if (!isHost || phase !== JUST_ONE_PHASE_WON) return undefined;
        const wonKey = `${roomId}:${roundNumber}`;
        if (handledWonRoundRef.current === wonKey) return undefined;
        handledWonRoundRef.current = wonKey;
        void quickResetWordAndRoles();
        return undefined;
    }, [isHost, phase, roundNumber, roomId, quickResetWordAndRoles]);

    return (
        <div className="telepathy-game just-one-game">
            {!roomData.isGameStarted ? (
                <div>
                    <GameRules title={t('games.just-one.name')}>
                        <GameRulesList gameId="just-one" />
                    </GameRules>

                    {isHost ? (
                        <div className="telepathy-lobby-actions">
                            <CollapsibleSection
                                toggleLabel={t('gameSetup.justOne.roundSettingsShow')}
                                toggleLabelOpen={t('gameSetup.justOne.roundSettingsHide')}
                            >
                                <JustOneAutoRoundToggle autoRound={autoRound} onToggle={toggleAutoRound} t={t} />
                            </CollapsibleSection>

                            <CollapsibleSection
                                toggleLabel={t('gameLobby.categoriesShow', {
                                    selected: selectedCategories.length,
                                    total: playableCategories.length,
                                })}
                                toggleLabelOpen={t('gameLobby.categoriesHide')}
                                defaultOpen
                            >
                                <p className="collapsible-section__lead">{t('gameLobby.categoriesLead')}</p>
                                <div className="games-grid categories-grid">
                                    {playableCategories.map((cat) => {
                                        const isSelected = selectedCategories.includes(cat.id);
                                        return (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => toggleCategory(cat.id)}
                                                className={
                                                    isSelected
                                                        ? 'category-btn-selected'
                                                        : 'category-btn-unselected'
                                                }
                                            >
                                                <span className="game-title">{cat.name}</span>
                                                <span className="game-desc">{cat.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>

                            <div className="lobby-start-actions actions-stack">
                                <button
                                    type="button"
                                    onClick={() => void startGame()}
                                    className="btn-accent btn-lobby-start"
                                    disabled={!canStartLobby}
                                >
                                    {t('gameSetup.justOne.startButton', {
                                        count: selectedCategories.length,
                                    })}
                                </button>
                                {selectedCategories.length === 0 && (
                                    <p className="impostor-start-hint text-error">
                                        {t('gameSetup.justOne.needCategory')}
                                    </p>
                                )}
                                {lobbyPlayerCount < 3 && (
                                    <p className="impostor-start-hint text-error">
                                        {t('gameSetup.justOne.needPlayers')}
                                    </p>
                                )}
                                {startErrorKey ? (
                                    <p className="impostor-start-hint text-error">{t(startErrorKey)}</p>
                                ) : null}
                                <p className="impostor-impostor-count-hint">
                                    {t('gameSetup.justOne.playersHint', { count: lobbyPlayerCount })}
                                </p>
                            </div>
                            <HostShareOptions shareOptions={shareOptions} />
                        </div>
                    ) : (
                        <p className="telepathy-wait-host">{t('gameLobby.waitForHostJustOne')}</p>
                    )}
                </div>
            ) : (
                <div>
                    <p className="telepathy-round-text">
                        {t('gameUi.justOneRound', { round: roundNumber })}
                    </p>

                    {isPeeking && (
                        <>
                            <p className="impostor-peeking-header">{t('gameUi.justOnePeekPhase')}</p>
                            {iAmListener ? (
                                clueGiverGuests.length > 0 ? (
                                    <SharedPhoneRoleReveal
                                        resetEpoch={roleRevealEpoch}
                                        skipOwnerStep
                                        guests={clueGiverGuests}
                                        ownerPeekClassName="impostor-bg-hidden"
                                        renderOwnerReveal={() => null}
                                        renderGuestReveal={(guest) =>
                                            renderWordReveal(getPrivateWord(privateRoles[guest.id]))
                                        }
                                    />
                                ) : (
                                    <div className="peek-panel impostor-bg-bad just-one-listener-peek">
                                        {renderListenerPeek()}
                                    </div>
                                )
                            ) : iAmClueGiver && clueGiverGuests.length > 0 ? (
                                <SharedPhoneRoleReveal
                                    resetEpoch={roleRevealEpoch}
                                    guests={clueGiverGuests}
                                    ownerPeekClassName="impostor-bg-good"
                                    renderOwnerReveal={() => renderWordReveal(myDisplayWord)}
                                    renderGuestReveal={(guest) =>
                                        renderWordReveal(getPrivateWord(privateRoles[guest.id]))
                                    }
                                />
                            ) : iAmClueGiver ? (
                                <>
                                    <div
                                        onMouseDown={() => setShowRole(true)}
                                        onMouseUp={() => setShowRole(false)}
                                        onMouseLeave={() => setShowRole(false)}
                                        onTouchStart={() => setShowRole(true)}
                                        onTouchEnd={() => setShowRole(false)}
                                        className={`peek-panel ${showRole ? 'impostor-bg-good' : 'impostor-bg-hidden'}`}
                                    >
                                        {!showRole ? (
                                            <h3 className="peek-hidden-text">
                                                {t('gameUi.justOneHoldToSeeWord')}
                                            </h3>
                                        ) : (
                                            renderWordReveal(myDisplayWord)
                                        )}
                                    </div>
                                    <p className="impostor-secret-warning">{t('sharedPhone.secretWarning')}</p>
                                </>
                            ) : (
                                <p className="telepathy-wait-host">{t('gameUi.justOneSpectator')}</p>
                            )}
                        </>
                    )}

                    {isHost && (
                        <div
                            className={`telepathy-live-settings just-one-auto-settings${isPeeking ? ' just-one-auto-settings--after-peek' : ''}`}
                        >
                            <JustOneAutoRoundToggle autoRound={autoRound} onToggle={toggleAutoRound} t={t} />
                        </div>
                    )}

                    {isWon && (
                        <p className="telepathy-game-over">{t('gameUi.justOneGameOver')}</p>
                    )}

                    {isSubmitting && usedClueLabels.length > 0 && !iAmListener && (
                        <div className="telepathy-used-words content-panel content-panel--dark">
                            <p className="telepathy-used-words__title">{t('gameUi.justOneUsedClues')}</p>
                            <p className="telepathy-used-words__list">{usedClueLabels.join(', ')}</p>
                        </div>
                    )}

                    {isSubmitting && !iAmListener && lastRoundReview && (
                        <div className="content-panel content-panel--dark just-one-clue-review">
                            <p className="just-one-clue-review__title">
                                {t('gameUi.justOneListenerLastRound', { round: lastRoundReview.round })}
                            </p>
                            <JustOneCluesTable
                                entries={lastRoundReview.entries}
                                getPlayerName={(id) => listenerNameById.get(id) || '—'}
                                t={t}
                                showDuplicateWord
                            />
                            <p className="telepathy-hint">{t('gameUi.justOneRevealHint')}</p>
                        </div>
                    )}

                    {isSubmitting && (
                        <>
                            {iAmListener && listenerClueGrid.rounds.length > 0 && (
                                <div className="content-panel content-panel--dark just-one-listener-clues">
                                    <p className="just-one-listener-clues__title">
                                        {t('gameUi.justOneListenerCluesTitle')}
                                    </p>
                                    <JustOneListenerCluesBoard
                                        grid={listenerClueGrid}
                                        getPlayerName={(id) => listenerNameById.get(id) || '—'}
                                        t={t}
                                        currentRound={roundNumber}
                                    />
                                    <p className="telepathy-hint just-one-listener-clues__hint">
                                        {t('gameUi.justOneListenerRevealHint')}
                                    </p>
                                </div>
                            )}

                            {canMarkGuessed && (
                                <button
                                    type="button"
                                    className="btn-main-action just-one-guessed-btn"
                                    disabled={rtdbBusy}
                                    onClick={() => void markGuessed()}
                                >
                                    {t('gameUi.justOneGuessed')}
                                </button>
                            )}
                            {isHost && (
                                <button
                                    type="button"
                                    className="btn-impostor-discuss just-one-force-next-btn"
                                    disabled={rtdbBusy || quickResetInFlightRef.current}
                                    onClick={() => void quickResetWordAndRoles()}
                                >
                                    {t('gameUi.justOneQuickReset')}
                                </button>
                            )}

                            {isHost && isSubmitting && everyoneSubmitted && (
                                <button
                                    type="button"
                                    className="btn-impostor-discuss just-one-force-next-btn"
                                    disabled={rtdbBusy}
                                    onClick={() => void tryAdvanceJustOneRound()}
                                >
                                    {t('gameUi.justOneForceNext')}
                                </button>
                            )}

                            {clueGiverIds.length === 0 ? (
                                <p className="telepathy-error">{t('gameUi.justOneNoClueGivers')}</p>
                            ) : null}

                            {iAmListener ? (
                                <p className="telepathy-hint">{t('gameUi.justOneListenerWait')}</p>
                            ) : (
                                <>
                                    <p className="telepathy-hint">
                                        {t('gameUi.justOneClueHint', { listener: listener?.name || '—' })}
                                    </p>
                                    {clueGiverIds.length > 0 && (
                                        <p className="telepathy-status">
                                            {t('gameUi.justOnePending', { count: pendingCount })}
                                        </p>
                                    )}

                                    {playersICanSubmitFor.map((player) => {
                                        const already = submitted[player.id] === true;
                                        const isMe = player.id === myPlayerId;
                                        const label = isMe
                                            ? t('gameUi.justOneYourClue')
                                            : t('gameUi.justOneGuestClue', { name: player.name });
                                        return (
                                            <JustOneClueForm
                                                key={player.id}
                                                label={label}
                                                playerId={player.id}
                                                disabled={already}
                                                clueHistory={clueHistory}
                                                onSubmit={submitClue}
                                                busy={rtdbBusy}
                                                t={t}
                                            />
                                        );
                                    })}

                                    {playersICanSubmitFor.length === 0 && !iAmListener && (
                                        <p className="telepathy-wait-host">{t('gameUi.justOneSpectator')}</p>
                                    )}

                                    {playersICanSubmitFor.length > 0
                                        && iAmFullySubmitted
                                        && pendingCount > 0
                                        && pendingNames && (
                                        <p className="telepathy-wait-others">
                                            {t('gameUi.justOneWaitOthers', { names: pendingNames })}
                                        </p>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {isHost && !isPeeking && (
                        <div className="game-host-controls">
                            <HostShareOptions shareOptions={shareOptions} />
                            <ConfirmButton onClick={() => void forceResetTable()} text={t('gameUi.resetTable')} />
                        </div>
                    )}

                    {isHost && isPeeking && (
                        <div className="game-host-controls">
                            <button
                                type="button"
                                className="btn-impostor-discuss"
                                onClick={() => void startSubmittingPhase()}
                            >
                                {t('gameUi.justOneStartClues')}
                            </button>
                            <HostShareOptions shareOptions={shareOptions} />
                        </div>
                    )}

                    {isHost && !isPeeking && isSubmitting && (
                        <div className="role-replay-bar">
                            <button type="button" className="btn-role-replay" onClick={() => void replayWord()}>
                                {t('gameUi.justOneReplayWord')}
                            </button>
                        </div>
                    )}
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

export default JustOne;
