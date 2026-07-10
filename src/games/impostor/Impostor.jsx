import { useState, useCallback, useMemo, useEffect } from 'react';
import { ref } from 'firebase/database';
import { set, get, update, isRtdbPermissionDenied } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { recordGameStarted } from '../../lib/appMetrics.js';
import { getImpostorCategories, getCategoryLabel } from '../../lib/gameContentUtils';
import { useLocale } from '../../locales/LocaleContext';
import { useRoomGameState } from '../../lib/useRoomGameState';
import { useRoomSettings } from '../../lib/useRoomSettings';
import { buildRoundState } from './engine';
import ConfirmButton from '../../components/ConfirmButton';
import GameRules from '../../components/GameRules';
import GameRulesList from '../../components/GameRulesList';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';
import SharedPhoneRoleReveal from '../../components/SharedPhoneRoleReveal';
import GameLobbyGuestWait from '../../components/GameLobbyGuestWait';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useCategorySelection } from '../../lib/useCategorySelection';
import {
    isLegacyImpostorState,
    usesImpostorPrivacyModel,
    buildImpostorPrivacyUpdates,
    buildImpostorPrivacyPatchUpdates,
    buildImpostorLegacyStartUpdates,
    buildImpostorResetUpdates,
    getImpostorPreviousRoundFromHostOnly,
} from '../../lib/roomPrivateState';
import {
    useHostOnlyGameState,
    usePrivateRolesForPlayers,
    getPrivateImpostorFlag,
    getPrivateWord,
} from '../../lib/usePrivateGameState';
import GameHostResetButton from '../../components/GameHostResetButton';
import GameRoomExitBar from '../../components/GameRoomExitBar';

const DEFAULT_SETTINGS = { fairnessEnabled: false };

function Impostor({
    isHost,
    canManageRoom = isHost,
    onLeave,
    gameId = 'impostor',
    myPlayerId,
    tablePlayers = [],
    isRoomLocked = false,
    roomId,
    shareOptions,
}) {
    const { gameContent, t } = useLocale();
    const impostorSection = gameContent.impostor ?? impostorFallback;

    const playableCategories = useMemo(
        () => getImpostorCategories(impostorSection),
        [impostorSection]
    );

    const lobbyPlayerCount = useMemo(() => getTablePlayers(tablePlayers).length, [tablePlayers]);

    const myLinkedGuests = useMemo(
        () => getGuestsForOwner(tablePlayers, myPlayerId),
        [tablePlayers, myPlayerId]
    );

    const maxImpostors = Math.max(1, lobbyPlayerCount - 1);

    const [impostorCount, setImpostorCount] = useState(1);
    const [randomImpostorCount, setRandomImpostorCount] = useState(false);
    const [randomImpostorMaxCount, setRandomImpostorMaxCount] = useState(maxImpostors);
    const [showRole, setShowRole] = useState(false);
    const [startErrorKey, setStartErrorKey] = useState('');

    useEffect(() => {
        if (impostorCount <= maxImpostors) return undefined;
        const timeoutId = setTimeout(() => setImpostorCount(Math.max(1, maxImpostors)), 0);
        return () => clearTimeout(timeoutId);
    }, [impostorCount, maxImpostors]);

    const effectiveRandomImpostorMaxCount = useMemo(() => {
        const hardMax = Math.max(1, lobbyPlayerCount);
        return Math.min(hardMax, Math.max(1, randomImpostorMaxCount));
    }, [lobbyPlayerCount, randomImpostorMaxCount]);

    const roomSettings = useRoomSettings(roomId, DEFAULT_SETTINGS);

    const defaultRoomState = useMemo(
        () => ({
            phase: 'lobby',
            word: '',
            impostorIds: [],
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            totalImpostors: 0,
            eliminatedImpostors: 0,
            roundResult: '',
        }),
        []
    );

    const impostorGameStateFingerprint = useCallback((data) => {
        const impostorIds = Array.isArray(data?.impostorIds)
            ? data.impostorIds.join(',')
            : (data?.impostorId || '');
        return [
            data?.phase ?? '',
            data?.roleRevealEpoch ?? 0,
            data?.isGameStarted ? '1' : '0',
            data?.categoryName ?? '',
            data?.word ?? '',
            data?.startingPlayerId ?? '',
            impostorIds,
            data?.roundResult ?? '',
            data?.eliminatedImpostors ?? 0,
        ].join('|');
    }, []);

    const roomData = useRoomGameState(roomId, defaultRoomState, {
        mergeDefaults: true,
        getFingerprint: impostorGameStateFingerprint,
    });

    const lastPlayedCategoryIds = useMemo(() => {
        if (roomData.phase !== 'lobby') return undefined;
        return Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
            ? roomData.categoryIds
            : undefined;
    }, [roomData.phase, roomData.categoryIds]);

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
    } = useCategorySelection(playableCategories, { lastPlayedCategoryIds });

    useEffect(() => {
        setStartErrorKey('');
    }, [selectedCategories, lobbyPlayerCount]);

    const roleRevealEpoch = roomData.roleRevealEpoch ?? 0;
    const isLegacy = isLegacyImpostorState(roomData);
    const usePrivacy = usesImpostorPrivacyModel(roomData);

    const linkedPlayerIds = useMemo(
        () => [myPlayerId, ...myLinkedGuests.map((g) => g.id)].filter(Boolean),
        [myPlayerId, myLinkedGuests]
    );

    const privateRoles = usePrivateRolesForPlayers(
        usePrivacy ? roomId : null,
        usePrivacy ? linkedPlayerIds : []
    );
    const hostOnlyState = useHostOnlyGameState(roomId, isHost && (usePrivacy || roomData.phase !== 'lobby'));

    usePiGameSession(roomData.phase !== 'lobby');

    const legacyImpostorIds = useMemo(() => {
        if (Array.isArray(roomData.impostorIds) && roomData.impostorIds.length > 0) {
            return roomData.impostorIds;
        }
        if (roomData.impostorId) {
            return [roomData.impostorId];
        }
        return [];
    }, [roomData.impostorIds, roomData.impostorId]);

    const revealImpostorIds = useMemo(() => {
        if (usePrivacy && hostOnlyState?.impostorIds) {
            return hostOnlyState.impostorIds;
        }
        return legacyImpostorIds;
    }, [usePrivacy, hostOnlyState, legacyImpostorIds]);

    const changeImpostorCount = useCallback(
        (delta) => {
            if (randomImpostorCount) {
                setRandomImpostorMaxCount((prev) => {
                    const hardMax = Math.max(1, lobbyPlayerCount);
                    const next = prev + delta;
                    if (next < 1) return 1;
                    if (next > hardMax) return hardMax;
                    return next;
                });
                return;
            }
            setImpostorCount((prev) => {
                const next = prev + delta;
                if (next < 1) return 1;
                if (next > maxImpostors) return maxImpostors;
                return next;
            });
        },
        [maxImpostors, randomImpostorCount, lobbyPlayerCount]
    );

    const toggleFairness = useCallback(() => {
        set(ref(db, `rooms/${roomId}/settings/fairnessEnabled`), !roomSettings.fairnessEnabled);
    }, [roomSettings.fairnessEnabled, roomId]);

    const startGame = useCallback(async () => {
        setStartErrorKey('');
        if (selectedCategories.length === 0) {
            setStartErrorKey('gameSetup.impostor.needCategory');
            return;
        }

        const wordsByCategory = impostorSection?.words ?? {};
        const categoryIds = selectedCategories.filter(
            (id) => Array.isArray(wordsByCategory[id]) && wordsByCategory[id].length > 0
        );
        if (categoryIds.length === 0) {
            setStartErrorKey('gameSetup.impostor.startFailed');
            return;
        }

        try {
            const playerIds = getTablePlayers(tablePlayers).map((p) => p.id);

            if (playerIds.length < 2) {
                setStartErrorKey('gameSetup.impostor.needPlayers');
                return;
            }

            const historySnap = await get(ref(db, `rooms/${roomId}/roleHistory`));
            const roleHistory = historySnap.val();
            const nextRound = buildRoundState({
                playerIds,
                categoryIds,
                wordsByCategory,
                roleHistory,
                fairnessEnabled: roomSettings.fairnessEnabled,
                randomImpostorCount,
                randomImpostorMaxCount: effectiveRandomImpostorMaxCount,
                selectedImpostorCount: impostorCount,
            });
            if (!nextRound || nextRound.chosenImpostorIds.length === 0) {
                setStartErrorKey('gameSetup.impostor.startFailed');
                return;
            }
            const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);

            const publicFields = {
                categoryName: catNameDisplay,
                categoryIds,
                roleRevealEpoch: 1,
            };
            const privacyUpdates = {
                [`rooms/${roomId}/roleHistory`]: nextRound.updatedHistory,
                ...buildImpostorPrivacyUpdates(roomId, playerIds, nextRound, publicFields),
            };

            try {
                await update(ref(db), privacyUpdates);
            } catch (privacyErr) {
                if (!isRtdbPermissionDenied(privacyErr)) throw privacyErr;
                console.warn('[impostor] privacy write rejected — falling back to legacy gameState', privacyErr);
                await update(ref(db), {
                    [`rooms/${roomId}/roleHistory`]: nextRound.updatedHistory,
                    ...buildImpostorLegacyStartUpdates(roomId, nextRound, publicFields),
                });
            }
            recordGameStarted(roomId, 'impostor');
        } catch (err) {
            console.error('[impostor] startGame', err);
            if (isRtdbPermissionDenied(err)) {
                setStartErrorKey('gameSetup.impostor.startErrorPermission');
            } else {
                setStartErrorKey('gameSetup.impostor.startError');
            }
        }
    }, [
        selectedCategories,
        playableCategories,
        impostorCount,
        impostorSection,
        randomImpostorCount,
        effectiveRandomImpostorMaxCount,
        roomSettings.fairnessEnabled,
        roomId,
        tablePlayers,
    ]);

    const drawNextWord = useCallback(async () => {
        const categoryIds =
            Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
                ? roomData.categoryIds
                : selectedCategories;

        if (categoryIds.length === 0) return;

        const playerIds = getTablePlayers(tablePlayers).map((p) => p.id);
        if (playerIds.length < 2) return;

        const previousStartingPlayerId = roomData.startingPlayerId ?? null;
        const previousFromPrivacy = getImpostorPreviousRoundFromHostOnly(hostOnlyState);
        const previousImpostorIds = isLegacy
            ? (Array.isArray(roomData.impostorIds)
                ? roomData.impostorIds
                : roomData.impostorId
                    ? [roomData.impostorId]
                    : [])
            : previousFromPrivacy.previousImpostorIds;
        const previousWord = isLegacy ? roomData.word : previousFromPrivacy.previousWord;

        const desiredCountFromState =
            Number.isInteger(roomData.totalImpostors) && roomData.totalImpostors > 0
                ? roomData.totalImpostors
                : impostorCount;
        const effectiveImpostorCount = Math.min(desiredCountFromState, Math.max(1, playerIds.length - 1));
        const historySnap = await get(ref(db, `rooms/${roomId}/roleHistory`));
        const roleHistory = historySnap.val();

        const nextRound = buildRoundState({
            playerIds,
            desiredImpostorCount: effectiveImpostorCount,
            previousImpostorIds,
            previousStartingPlayerId,
            previousWord,
            categoryIds,
            wordsByCategory: impostorSection?.words,
            roleHistory,
            fairnessEnabled: roomSettings.fairnessEnabled,
        });
        if (!nextRound) return;
        const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);

        if (isLegacy) {
            await Promise.all([
                set(ref(db, `rooms/${roomId}/roleHistory`), nextRound.updatedHistory),
                update(ref(db, `rooms/${roomId}/gameState`), {
                    word: nextRound.randomWord,
                    impostorIds: nextRound.chosenImpostorIds,
                    categoryName: catNameDisplay,
                    startingPlayerId: nextRound.startingPlayerId,
                    phase: 'peeking',
                    roleRevealEpoch: roleRevealEpoch + 1,
                    totalImpostors: nextRound.chosenImpostorIds.length,
                    eliminatedImpostors: 0,
                    roundResult: '',
                    revealAllRoles: false,
                }),
            ]);
        } else {
            await Promise.all([
                set(ref(db, `rooms/${roomId}/roleHistory`), nextRound.updatedHistory),
                update(ref(db), buildImpostorPrivacyPatchUpdates(roomId, playerIds, nextRound, {
                    categoryName: catNameDisplay,
                    roleRevealEpoch: roleRevealEpoch + 1,
                })),
            ]);
        }
        setShowRole(false);
    }, [
        roomData.categoryIds,
        roomData.word,
        isLegacy,
        hostOnlyState,
        roomData.startingPlayerId,
        roomData.totalImpostors,
        selectedCategories,
        playableCategories,
        roleRevealEpoch,
        impostorCount,
        roomSettings.fairnessEnabled,
        roomId,
        tablePlayers,
    ]);

    const canDrawNextWord =
        (Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0) ||
        selectedCategories.length > 0;

    const startDiscussion = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState/phase`), 'discussing');
        setShowRole(false);
    }, [roomId]);

    const replayRoles = useCallback(async () => {
        if (isRoomLocked) return;
        await update(ref(db, `rooms/${roomId}/gameState`), {
            phase: 'peeking',
            roleRevealEpoch: roleRevealEpoch + 1,
        });
        setShowRole(false);
    }, [isRoomLocked, roleRevealEpoch, roomId]);

    const forceResetTable = useCallback(() => {
        if (isLegacy) {
            set(ref(db, `rooms/${roomId}/gameState`), {
                phase: 'lobby',
                word: '',
                impostorIds: [],
                categoryName: '',
                startingPlayerId: null,
                categoryIds: [],
                roleRevealEpoch: 0,
                totalImpostors: 0,
                eliminatedImpostors: 0,
                roundResult: '',
                revealAllRoles: false,
            });
        } else {
            update(ref(db), buildImpostorResetUpdates(roomId));
        }
        setShowRole(false);
    }, [isLegacy, roomId]);

    const updateEliminatedImpostors = useCallback(
        async (delta) => {
            if (!isHost) return;
            const total = Math.max(
                0,
                Number.isInteger(roomData.totalImpostors)
                    ? roomData.totalImpostors
                    : revealImpostorIds.length
            );
            const current = Math.max(
                0,
                Number.isInteger(roomData.eliminatedImpostors) ? roomData.eliminatedImpostors : 0
            );
            const next = Math.min(total, Math.max(0, current + delta));
            if (next === current) return;
            const updates = {
                eliminatedImpostors: next,
            };
            if (next >= total && total > 0) {
                updates.roundResult = '✅ Wygrywacie! Wyrzucono wszystkich Impostorów.';
                updates.phase = 'discussing';
            }
            await update(ref(db, `rooms/${roomId}/gameState`), updates);
        },
        [isHost, roomData.totalImpostors, roomData.eliminatedImpostors, revealImpostorIds.length, roomId]
    );

    const amIImpostor = usePrivacy
        ? getPrivateImpostorFlag(privateRoles[myPlayerId])
        : legacyImpostorIds.includes(myPlayerId);

    const myDisplayWord = usePrivacy
        ? getPrivateWord(privateRoles[myPlayerId])
        : roomData.word;

    const isGuestImpostor = useCallback(
        (guestId) => (usePrivacy
            ? getPrivateImpostorFlag(privateRoles[guestId])
            : legacyImpostorIds.includes(guestId)),
        [usePrivacy, privateRoles, legacyImpostorIds]
    );

    const startingPlayerName = useMemo(() => {
        if (!roomData.startingPlayerId) return null;
        const player = tablePlayers.find((p) => p.id === roomData.startingPlayerId);
        return player?.name ?? 'Nieznany gracz';
    }, [roomData.startingPlayerId, tablePlayers]);

    const canStart =
        selectedCategories.length > 0 &&
        lobbyPlayerCount >= 2 &&
        (!randomImpostorCount
            ? impostorCount <= maxImpostors
            : effectiveRandomImpostorMaxCount >= 1 && effectiveRandomImpostorMaxCount <= lobbyPlayerCount);
    const revealAllRoles = roomData.revealAllRoles === true && roomData.phase !== 'lobby';

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    <GameRules title={t('games.impostor.name')}>
                        <GameRulesList gameId="impostor" />
                    </GameRules>

                    {isHost ? (
                        <>
                            <CollapsibleSection
                                toggleLabel={t('gameSetup.impostor.roundSettingsShow')}
                                toggleLabelOpen={t('gameSetup.impostor.roundSettingsHide')}
                                defaultOpen={false}
                            >
                                <div className="impostor-room-settings">
                                    <button
                                        type="button"
                                        className="settings-toggle impostor-fairness-toggle"
                                        onClick={toggleFairness}
                                        aria-pressed={roomSettings.fairnessEnabled}
                                    >
                                        <span className="impostor-fairness-toggle__text">
                                            <strong>{t('gameSetup.impostor.fairnessTitle')}</strong>
                                            <span className="impostor-fairness-toggle__hint">
                                                {roomSettings.fairnessEnabled
                                                    ? t('gameSetup.impostor.fairnessOn')
                                                    : t('gameSetup.impostor.fairnessOff')}
                                            </span>
                                        </span>
                                        <span
                                            className={`settings-toggle__icon ${roomSettings.fairnessEnabled ? 'on' : 'off'}`}
                                        >
                                            {roomSettings.fairnessEnabled ? '✔' : '✕'}
                                        </span>
                                    </button>
                                </div>

                                <div className="impostor-impostor-count-box">
                                    <h3 className="impostor-impostor-count-title">{t('gameSetup.impostor.impostorCountTitle')}</h3>
                                    <button
                                        type="button"
                                        className="settings-toggle impostor-random-toggle"
                                        onClick={() =>
                                            setRandomImpostorCount((prev) => {
                                                const next = !prev;
                                                if (next) {
                                                    const defaultMax = Math.max(1, lobbyPlayerCount - 1);
                                                    const hardMax = Math.max(1, lobbyPlayerCount);
                                                    setRandomImpostorMaxCount(Math.min(hardMax, defaultMax));
                                                }
                                                return next;
                                            })
                                        }
                                        aria-pressed={randomImpostorCount}
                                    >
                                        <span>{t('gameSetup.impostor.randomImpostorCount')}</span>
                                        <span className={`settings-toggle__icon ${randomImpostorCount ? 'on' : 'off'}`}>
                                            {randomImpostorCount ? '✔' : '✕'}
                                        </span>
                                    </button>
                                    <div className="impostor-impostor-count-row">
                                        <button
                                            type="button"
                                            onClick={() => changeImpostorCount(-1)}
                                            className="btn-impostor-counter"
                                            disabled={
                                                randomImpostorCount
                                                    ? effectiveRandomImpostorMaxCount <= 1
                                                    : impostorCount <= 1
                                            }
                                        >
                                            −
                                        </button>
                                        <span className="impostor-impostor-count-value">
                                            {randomImpostorCount ? effectiveRandomImpostorMaxCount : impostorCount}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => changeImpostorCount(1)}
                                            className="btn-impostor-counter"
                                            disabled={
                                                randomImpostorCount
                                                    ? effectiveRandomImpostorMaxCount >= Math.max(1, lobbyPlayerCount)
                                                    : impostorCount >= maxImpostors
                                            }
                                        >
                                            +
                                        </button>
                                    </div>
                                    <p className="impostor-impostor-count-hint">
                                        {randomImpostorCount
                                            ? t('gameSetup.impostor.playersHintRandom', {
                                                count: lobbyPlayerCount,
                                                max: effectiveRandomImpostorMaxCount,
                                                hardMax: Math.max(1, lobbyPlayerCount),
                                            })
                                            : t('gameSetup.impostor.playersHintFixed', {
                                                count: lobbyPlayerCount,
                                                max: maxImpostors,
                                            })}
                                    </p>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                                toggleLabel={t('gameLobby.categoriesShow', {
                                    selected: selectedCategories.length,
                                    total: playableCategories.length,
                                })}
                                toggleLabelOpen={t('gameLobby.categoriesHide')}
                                defaultOpen={true}
                            >
                                <p className="collapsible-section__lead">
                                    {t('gameLobby.categoriesLead')}
                                </p>
                                <div className="games-grid categories-grid">
                                    {playableCategories.map((cat) => {
                                        const isSelected = selectedCategories.includes(cat.id);
                                        return (
                                            <button
                                                key={cat.id}
                                                onClick={() => toggleCategory(cat.id)}
                                                className={
                                                    isSelected ? 'category-btn-selected' : 'category-btn-unselected'
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
                                    onClick={startGame}
                                    className="btn-accent btn-lobby-start"
                                    disabled={!canStart}
                                >
                                    {t('gameSetup.impostor.startButton', { count: selectedCategories.length })}
                                </button>
                                {selectedCategories.length === 0 && (
                                    <p className="impostor-start-hint text-error">
                                        {t('gameSetup.impostor.needCategory')}
                                    </p>
                                )}
                                {lobbyPlayerCount < 2 && (
                                    <p className="impostor-start-hint text-error">
                                        {t('gameSetup.impostor.needPlayers')}
                                    </p>
                                )}
                                {startErrorKey && (
                                    <p className="impostor-start-hint text-error">{t(startErrorKey)}</p>
                                )}
                            </div>
                            <HostShareOptions shareOptions={shareOptions} />
                        </>
                    ) : (
                        <GameLobbyGuestWait gameId={gameId} />
                    )}
                </div>
            ) : (
                <div>
                    {revealAllRoles && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">ADMIN REVEAL: Role ujawnione</h2>
                            <div className="players-list">
                                {getTablePlayers(tablePlayers).map((player) => (
                                    <span key={player.id} className="player-tag">
                                        {player.name}: {revealImpostorIds.includes(player.id) ? 'IMPOSTOR' : 'GRACZ'}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {startingPlayerName && (
                        <p className="impostor-starting-player">
                            Zaczyna: <strong>{startingPlayerName}</strong>
                        </p>
                    )}
                    {roomData.roundResult && (
                        <p className="impostor-starting-player">{roomData.roundResult}</p>
                    )}

                    {roomData.phase === 'peeking' && (
                        <>
                            <p className="impostor-peeking-header">Faza sprawdzania ról</p>
                            {myLinkedGuests.length > 0 ? (
                                <SharedPhoneRoleReveal
                                    resetEpoch={roleRevealEpoch}
                                    guests={myLinkedGuests}
                                    ownerPeekClassName={
                                        amIImpostor ? 'impostor-bg-bad' : 'impostor-bg-good'
                                    }
                                    renderOwnerReveal={() => (
                                        <>
                                            <h2
                                                className={`impostor-role-title ${amIImpostor ? 'text-danger' : 'text-success'}`}
                                            >
                                                {amIImpostor ? 'JESTEŚ OSZUSTEM!' : myDisplayWord}
                                            </h2>
                                            {amIImpostor && (
                                                <p className="impostor-cat-info">
                                                    Kategoria:{' '}
                                                    <span className="text-gold">{roomData.categoryName}</span>
                                                </p>
                                            )}
                                        </>
                                    )}
                                    renderGuestReveal={(guest) => {
                                        const guestIsImpostor = isGuestImpostor(guest.id);
                                        const guestWord = usePrivacy
                                            ? getPrivateWord(privateRoles[guest.id])
                                            : roomData.word;
                                        return (
                                            <>
                                                <h2
                                                    className={`impostor-role-title ${guestIsImpostor ? 'text-danger' : 'text-success'}`}
                                                >
                                                    {guestIsImpostor ? 'GOŚĆ JEST OSZUSTEM!' : guestWord}
                                                </h2>
                                                {guestIsImpostor && (
                                                    <p className="impostor-cat-info">
                                                        Kategoria:{' '}
                                                        <span className="text-gold">{roomData.categoryName}</span>
                                                    </p>
                                                )}
                                            </>
                                        );
                                    }}
                                />
                            ) : (
                                <>
                                    <div
                                        onMouseDown={() => setShowRole(true)}
                                        onMouseUp={() => setShowRole(false)}
                                        onMouseLeave={() => setShowRole(false)}
                                        onTouchStart={() => setShowRole(true)}
                                        onTouchEnd={() => setShowRole(false)}
                                        className={`peek-panel ${showRole ? (amIImpostor ? 'impostor-bg-bad' : 'impostor-bg-good') : 'impostor-bg-hidden'}`}
                                    >
                                        {!showRole ? (
                                            <h3 className="peek-hidden-text">
                                                Kliknij i przytrzymaj, aby zobaczyć rolę
                                            </h3>
                                        ) : (
                                            <>
                                                <h2
                                                    className={`impostor-role-title ${amIImpostor ? 'text-danger' : 'text-success'}`}
                                                >
                                                    {amIImpostor ? 'JESTEŚ OSZUSTEM!' : myDisplayWord}
                                                </h2>
                                                {amIImpostor && (
                                                    <p className="impostor-cat-info">
                                                        Kategoria:{' '}
                                                        <span className="text-gold">{roomData.categoryName}</span>
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="impostor-secret-warning">Ukryj ekran przed innymi!</p>
                                </>
                            )}
                        </>
                    )}

                    {roomData.phase === 'discussing' && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">Trwa dyskusja!</h2>
                            <p className="impostor-discussing-desc">
                                Ekrany zostały zablokowane. Czas znaleźć oszusta.
                            </p>
                            {!isRoomLocked && !isHost && myLinkedGuests.length > 0 && (
                                <p className="impostor-replay-hint">
                                    Zapomniałeś roli? Poproś hosta o ponowny podgląd.
                                </p>
                            )}
                        </div>
                    )}

                    {!isRoomLocked && roomData.phase === 'discussing' && (
                        <div className="role-replay-bar">
                            {isHost ? (
                                <button type="button" className="btn-role-replay" onClick={replayRoles}>
                                    Pokaż role ponownie (wszyscy)
                                </button>
                            ) : (
                                myLinkedGuests.length > 0 && (
                                    <p className="impostor-replay-hint">
                                        Zapomniałeś roli? Poproś hosta o ponowny podgląd.
                                    </p>
                                )
                            )}
                        </div>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            {roomData.phase === 'peeking' && (
                                <button onClick={startDiscussion} className="btn-impostor-discuss">
                                    Rozpocznij dyskusję (Zablokuj podgląd)
                                </button>
                            )}
                            {canDrawNextWord && (
                                <ConfirmButton
                                    onClick={drawNextWord}
                                    text="Losuj kolejne słowo"
                                />
                            )}
                            <div className="impostor-impostor-count-box">
                                <h3 className="impostor-impostor-count-title">Wyrzuceni Impostorzy</h3>
                                <div className="impostor-impostor-count-row">
                                    <button
                                        type="button"
                                        onClick={() => updateEliminatedImpostors(-1)}
                                        className="btn-impostor-counter"
                                        disabled={(roomData.eliminatedImpostors ?? 0) <= 0}
                                    >
                                        −
                                    </button>
                                    <span className="impostor-impostor-count-value">
                                        {roomData.eliminatedImpostors ?? 0}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => updateEliminatedImpostors(1)}
                                        className="btn-impostor-counter"
                                        disabled={
                                            (roomData.eliminatedImpostors ?? 0) >=
                                            (roomData.totalImpostors ?? revealImpostorIds.length)
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                                <p className="impostor-impostor-count-hint">
                                    Oznaczaj wyrzuconych Impostorów po głosowaniu (łączna liczba jest ukryta).
                                </p>
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

export default Impostor;
