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
import GameCategoryLobby from '../../components/GameCategoryLobby';
import CollapsibleSection from '../../components/CollapsibleSection';
import { HostShareOptions } from '../../components/RoomInviteQR';
import { useCategorySelection } from '../../lib/useCategorySelection';
import { usePiGameSession } from '../../lib/usePiGameSession';
import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';
import SharedPhoneRoleReveal from '../../components/SharedPhoneRoleReveal';
import TopTenModeSelector from './TopTenModeSelector';
import TopTenOrderingBoard from './TopTenOrderingBoard';
import {
    isIndividualOrderingMode,
    isTurnBasedOrderingMode,
    getOrderingInteractionKind,
    supportsOrderingAgree,
    advanceTurnPlayerId,
    normalizeOrderingMode,
    DEFAULT_TOP_TEN_ORDERING_MODE,
    scoreOrderAgainstRatings,
    buildTrueOrderByRatings,
    privateOrderToArray,
} from './orderingModes';
import {
    isLegacyTopTenState,
    usesTopTenPrivacyModel,
    buildTopTenPrivacyUpdates,
    buildTopTenPrivacyPatchUpdates,
    buildTopTenLegacyStartUpdates,
    buildTopTenResetUpdates,
    buildOrderingPhaseStartUpdates,
    getTopTenPreviousRoundFromHostOnly,
} from '../../lib/topTenState';
import {
    useHostOnlyGameState,
    usePrivateRolesForPlayers,
    getPrivateWord,
} from '../../lib/usePrivateGameState';

const DEFAULT_SETTINGS = { orderingMode: DEFAULT_TOP_TEN_ORDERING_MODE };

function shufflePlayerIds(playerIds) {
    const arr = [...playerIds];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getPrivateRating(privateEntry) {
    const rating = privateEntry?.rating;
    return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null;
}

function TopTen({
    isHost,
    hasAdminPowers = false,
    onLeave,
    onCloseRoom,
    onBackToMenu,
    myPlayerId,
    tablePlayers = [],
    isRoomLocked = false,
    roomId,
    shareOptions,
}) {
    const { gameContent, t } = useLocale();
    const topTenSection = gameContent.topTen ?? {};
    const roomSettings = useRoomSettings(roomId, DEFAULT_SETTINGS);

    const playableCategories = useMemo(
        () => getImpostorCategories(topTenSection),
        [topTenSection]
    );

    const lobbyPlayerCount = useMemo(() => getTablePlayers(tablePlayers).length, [tablePlayers]);

    const {
        selectedIds: selectedCategories,
        toggleId: toggleCategory,
        resetToAll: resetCategoriesToAll,
    } = useCategorySelection(playableCategories);

    const myLinkedGuests = useMemo(
        () => getGuestsForOwner(tablePlayers, myPlayerId),
        [tablePlayers, myPlayerId]
    );

    const [showSecret, setShowSecret] = useState(false);
    const [startErrorKey, setStartErrorKey] = useState('');
    const [swapSelection, setSwapSelection] = useState([]);
    const [pickMoveIndex, setPickMoveIndex] = useState(null);

    useEffect(() => {
        setStartErrorKey('');
    }, [playableCategories, lobbyPlayerCount]);

    const defaultRoomState = useMemo(
        () => ({
            phase: 'lobby',
            word: '',
            ratings: null,
            categoryName: '',
            startingPlayerId: null,
            categoryIds: [],
            roleRevealEpoch: 0,
            playerOrder: null,
        orderingMode: DEFAULT_TOP_TEN_ORDERING_MODE,
        orderingSubmitted: null,
        orderingSwapsUsed: null,
        orderingTurnPlayerId: null,
        orderingAgreed: null,
            revealRatings: false,
            revealedRatings: null,
            revealedIndividualOrders: null,
            individualScores: null,
        }),
        []
    );

    const topTenGameStateFingerprint = useCallback((data) => [
        data?.phase ?? '',
        data?.roleRevealEpoch ?? 0,
        data?.categoryName ?? '',
        data?.revealRatings ? '1' : '0',
        data?.orderingTurnPlayerId ?? '',
        data?.orderingAgreed ? '1' : '0',
        Array.isArray(data?.playerOrder) ? data.playerOrder.join(',') : '',
        data?.orderingMode ?? '',
        data?.orderingSubmitted ? '1' : '0',
    ].join('|'), []);

    const roomData = useRoomGameState(roomId, defaultRoomState, {
        mergeDefaults: true,
        getFingerprint: topTenGameStateFingerprint,
    });

    useEffect(() => {
        setSwapSelection([]);
        setPickMoveIndex(null);
    }, [roomData.phase, roomData.playerOrder, roomData.roleRevealEpoch, roomData.orderingTurnPlayerId]);

    const roleRevealEpoch = roomData.roleRevealEpoch ?? 0;
    const isLegacy = isLegacyTopTenState(roomData);
    const usePrivacy = usesTopTenPrivacyModel(roomData);

    const orderingMode = normalizeOrderingMode(
        roomData.phase === 'lobby' ? roomSettings.orderingMode : roomData.orderingMode
    );
    const isIndividual = isIndividualOrderingMode(orderingMode);
    const isTurnBased = isTurnBasedOrderingMode(orderingMode);
    const interactionKind = getOrderingInteractionKind(orderingMode);
    const orderingTurnPlayerId = roomData.orderingTurnPlayerId ?? null;
    const isMyOrderingTurn = isTurnBased && orderingTurnPlayerId === myPlayerId;

    const linkedPlayerIds = useMemo(
        () => [myPlayerId, ...myLinkedGuests.map((g) => g.id)].filter(Boolean),
        [myPlayerId, myLinkedGuests]
    );

    const privateRoles = usePrivateRolesForPlayers(
        usePrivacy ? roomId : null,
        usePrivacy ? linkedPlayerIds : []
    );
    const canManageGame = isHost || hasAdminPowers;
    const hostOnlyState = useHostOnlyGameState(roomId, canManageGame && (usePrivacy || roomData.phase !== 'lobby'));

    usePiGameSession(roomData.phase !== 'lobby');

    const myDisplayWord = usePrivacy
        ? getPrivateWord(privateRoles[myPlayerId])
        : roomData.word;
    const myDisplayRating = usePrivacy
        ? getPrivateRating(privateRoles[myPlayerId])
        : (roomData.ratings?.[myPlayerId] ?? null);

    const startingPlayerName = useMemo(() => {
        if (!roomData.startingPlayerId) return null;
        const player = tablePlayers.find((p) => p.id === roomData.startingPlayerId);
        return player?.name ?? 'Nieznany gracz';
    }, [roomData.startingPlayerId, tablePlayers]);

    const activePlayerIds = useMemo(
        () => getTablePlayers(tablePlayers).map((p) => p.id),
        [tablePlayers]
    );

    const myIndividualSubmitted = Boolean(
        roomData.orderingSubmitted?.[myPlayerId]
        || privateRoles[myPlayerId]?.topTenSubmitted
    );

    const turnPlayerName = useMemo(() => {
        if (!orderingTurnPlayerId) return null;
        const player = tablePlayers.find((p) => p.id === orderingTurnPlayerId);
        return player?.name ?? 'Nieznany gracz';
    }, [orderingTurnPlayerId, tablePlayers]);

    const agreedCount = useMemo(() => {
        if (!roomData.orderingAgreed) return 0;
        return Object.values(roomData.orderingAgreed).filter(Boolean).length;
    }, [roomData.orderingAgreed]);

    const allAgreed = isTurnBased
        && supportsOrderingAgree(orderingMode)
        && agreedCount >= activePlayerIds.length
        && activePlayerIds.length > 0;

    const sharedPlayerOrder = useMemo(() => {
        if (Array.isArray(roomData.playerOrder) && roomData.playerOrder.length > 0) {
            return roomData.playerOrder.filter((id) => activePlayerIds.includes(id));
        }
        return activePlayerIds;
    }, [roomData.playerOrder, activePlayerIds]);

    const myIndividualOrder = useMemo(() => {
        const raw = privateRoles[myPlayerId]?.topTenOrder ?? roomData.individualOrders?.[myPlayerId];
        const arr = privateOrderToArray(raw);
        if (arr.length > 0) {
            return arr.filter((id) => activePlayerIds.includes(id));
        }
        return activePlayerIds;
    }, [privateRoles, myPlayerId, roomData.individualOrders, activePlayerIds]);

    const displayOrder = isIndividual ? myIndividualOrder : sharedPlayerOrder;

    const canEditIndividual = roomData.phase === 'ordering'
        && isIndividual
        && !myIndividualSubmitted;

    const canEditSharedTurn = roomData.phase === 'ordering'
        && isTurnBased
        && isMyOrderingTurn;

    const canEditOrder = canEditSharedTurn || canEditIndividual;

    const ratingsByPlayerId = useMemo(() => {
        if (roomData.revealRatings && roomData.revealedRatings) return roomData.revealedRatings;
        if (usePrivacy && hostOnlyState?.ratings) return hostOnlyState.ratings;
        if (isLegacy && roomData.ratings) return roomData.ratings;
        return {};
    }, [roomData.revealRatings, roomData.revealedRatings, usePrivacy, hostOnlyState, isLegacy, roomData.ratings]);

    const submittedCount = useMemo(() => {
        if (!isIndividual || !roomData.orderingSubmitted) return 0;
        return Object.values(roomData.orderingSubmitted).filter(Boolean).length;
    }, [isIndividual, roomData.orderingSubmitted]);

    const setOrderingModeSetting = useCallback(
        (mode) => {
            set(ref(db, `rooms/${roomId}/settings/orderingMode`), normalizeOrderingMode(mode));
        },
        [roomId]
    );

    const startGame = useCallback(async () => {
        setStartErrorKey('');
        const wordsByCategory = topTenSection?.words ?? {};
        const categoryIds = selectedCategories.filter(
            (id) => Array.isArray(wordsByCategory[id]) && wordsByCategory[id].length > 0
        );
        if (categoryIds.length === 0) {
            setStartErrorKey('gameSetup.topTen.needCategory');
            return;
        }

        try {
            const playerIds = getTablePlayers(tablePlayers).map((p) => p.id);
            if (playerIds.length < 2) {
                setStartErrorKey('gameSetup.topTen.needPlayers');
                return;
            }

            const nextRound = buildRoundState({
                playerIds,
                categoryIds,
                wordsByCategory: topTenSection?.words ?? {},
            });
            if (!nextRound) {
                setStartErrorKey('gameSetup.topTen.startFailed');
                return;
            }

            const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);
            const mode = normalizeOrderingMode(roomSettings.orderingMode);
            const publicFields = {
                categoryName: catNameDisplay,
                categoryIds,
                roleRevealEpoch: 1,
                playerOrder: shufflePlayerIds(playerIds),
                orderingMode: mode,
            };

            const privacyUpdates = buildTopTenPrivacyUpdates(roomId, playerIds, nextRound, publicFields);

            try {
                await update(ref(db), privacyUpdates);
            } catch (privacyErr) {
                if (!isRtdbPermissionDenied(privacyErr)) throw privacyErr;
                await update(ref(db), buildTopTenLegacyStartUpdates(roomId, nextRound, publicFields));
            }
            recordGameStarted(roomId, 'top-ten');
        } catch (err) {
            console.error('[top-ten] startGame', err);
            setStartErrorKey(
                isRtdbPermissionDenied(err)
                    ? 'gameSetup.topTen.startErrorPermission'
                    : 'gameSetup.topTen.startError'
            );
        }
    }, [selectedCategories, playableCategories, topTenSection, roomId, roomSettings.orderingMode, tablePlayers]);

    const drawNextWord = useCallback(async () => {
        const categoryIds =
            Array.isArray(roomData.categoryIds) && roomData.categoryIds.length > 0
                ? roomData.categoryIds
                : playableCategories.map((c) => c.id);

        const playerIds = getTablePlayers(tablePlayers).map((p) => p.id);
        if (playerIds.length < 2) return;

        const previousFromHost = getTopTenPreviousRoundFromHostOnly(hostOnlyState);
        const previousWord = isLegacy ? roomData.word : previousFromHost.previousWord;

        const nextRound = buildRoundState({
            playerIds,
            previousStartingPlayerId: roomData.startingPlayerId ?? null,
            previousWord,
            categoryIds,
            wordsByCategory: topTenSection?.words ?? {},
        });
        if (!nextRound) return;

        const catNameDisplay = getCategoryLabel(playableCategories, nextRound.chosenCatId);
        const publicFields = {
            categoryName: catNameDisplay,
            roleRevealEpoch: roleRevealEpoch + 1,
            playerOrder: shufflePlayerIds(playerIds),
            orderingMode,
        };

        if (isLegacy) {
            await update(ref(db, `rooms/${roomId}/gameState`), {
                word: nextRound.randomWord,
                ratings: nextRound.ratingsByPlayerId,
                categoryName: catNameDisplay,
                startingPlayerId: nextRound.startingPlayerId,
                phase: 'peeking',
                roleRevealEpoch: roleRevealEpoch + 1,
                playerOrder: publicFields.playerOrder,
                orderingMode,
                orderingSubmitted: null,
                orderingSwapsUsed: null,
                orderingTurnPlayerId: null,
                orderingAgreed: null,
                revealRatings: false,
                revealedRatings: null,
                revealedIndividualOrders: null,
                individualScores: null,
            });
        } else {
            await update(ref(db), buildTopTenPrivacyPatchUpdates(roomId, playerIds, nextRound, publicFields));
        }
        setShowSecret(false);
        setSwapSelection([]);
    }, [
        roomData.categoryIds,
        roomData.word,
        roomData.startingPlayerId,
        isLegacy,
        hostOnlyState,
        roleRevealEpoch,
        playableCategories,
        topTenSection,
        roomId,
        orderingMode,
        tablePlayers,
    ]);

    const startOrderingPhase = useCallback(async () => {
        const playerIds = getTablePlayers(tablePlayers).map((p) => p.id);
        if (playerIds.length === 0) return;

        const shuffled = shufflePlayerIds(playerIds);
        const updates = buildOrderingPhaseStartUpdates(roomId, playerIds, shuffled, orderingMode);

        try {
            await update(ref(db), updates);
        } catch (err) {
            if (!isRtdbPermissionDenied(err)) throw err;
            const fallback = {
                [`rooms/${roomId}/gameState/phase`]: 'ordering',
                [`rooms/${roomId}/gameState/orderingSubmitted`]: null,
                [`rooms/${roomId}/gameState/orderingSwapsUsed`]: null,
                [`rooms/${roomId}/gameState/orderingTurnPlayerId`]: shuffled[0] ?? playerIds[0] ?? null,
                [`rooms/${roomId}/gameState/orderingAgreed`]: null,
            };
            if (isIndividualOrderingMode(orderingMode)) {
                for (const pid of playerIds) {
                    fallback[`rooms/${roomId}/gameState/individualOrders/${pid}`] = shuffled;
                }
            } else {
                fallback[`rooms/${roomId}/gameState/playerOrder`] = shuffled;
            }
            await update(ref(db), fallback);
        }
        setShowSecret(false);
        setSwapSelection([]);
    }, [roomId, orderingMode, tablePlayers]);

    const setPhase = useCallback(
        (phase) => {
            if (phase === 'ordering') {
                void startOrderingPhase();
                return;
            }
            set(ref(db, `rooms/${roomId}/gameState/phase`), phase);
            setShowSecret(false);
        },
        [roomId, startOrderingPhase]
    );

    const replaySecrets = useCallback(async () => {
        if (isRoomLocked) return;
        await update(ref(db, `rooms/${roomId}/gameState`), {
            phase: 'peeking',
            roleRevealEpoch: roleRevealEpoch + 1,
        });
        setShowSecret(false);
    }, [isRoomLocked, roleRevealEpoch, roomId]);

    const revealRatings = useCallback(async () => {
        const ratings = usePrivacy && hostOnlyState?.ratings
            ? hostOnlyState.ratings
            : roomData.ratings;

        const revealPayload = {
            phase: 'revealed',
            revealRatings: true,
            revealedRatings: ratings ?? null,
        };

        if (isIndividual) {
            const individualOrders = {};
            const scores = {};
            const privateSnap = await get(ref(db, `rooms/${roomId}/private`));
            const privateData = privateSnap.val() || {};
            for (const pid of activePlayerIds) {
                const order = privateOrderToArray(privateData[pid]?.topTenOrder);
                individualOrders[pid] = order;
                scores[pid] = scoreOrderAgainstRatings(order, ratings);
            }
            revealPayload.revealedIndividualOrders = individualOrders;
            revealPayload.individualScores = scores;
        }

        await update(ref(db, `rooms/${roomId}/gameState`), revealPayload);
    }, [roomId, usePrivacy, hostOnlyState, roomData.ratings, isIndividual, activePlayerIds]);

    const advanceSharedTurn = useCallback(
        (nextOrder, resetAgreed = true) => {
            const nextTurn = advanceTurnPlayerId(activePlayerIds, myPlayerId);
            const payload = {
                [`rooms/${roomId}/gameState/playerOrder`]: nextOrder,
                [`rooms/${roomId}/gameState/orderingTurnPlayerId`]: nextTurn,
            };
            if (resetAgreed) {
                payload[`rooms/${roomId}/gameState/orderingAgreed`] = null;
            }
            update(ref(db), payload);
            setSwapSelection([]);
            setPickMoveIndex(null);
        },
        [activePlayerIds, myPlayerId, roomId]
    );

    const advanceTurnOnly = useCallback(() => {
        const nextTurn = advanceTurnPlayerId(activePlayerIds, myPlayerId);
        update(ref(db), {
            [`rooms/${roomId}/gameState/orderingTurnPlayerId`]: nextTurn,
        });
        setSwapSelection([]);
        setPickMoveIndex(null);
    }, [activePlayerIds, myPlayerId, roomId]);

    const persistSharedOrderOnly = useCallback(
        (next) => {
            update(ref(db), {
                [`rooms/${roomId}/gameState/playerOrder`]: next,
                [`rooms/${roomId}/gameState/orderingAgreed`]: null,
            });
        },
        [roomId]
    );

    const persistIndividualOrder = useCallback(
        (next) => {
            update(ref(db), {
                [`rooms/${roomId}/private/${myPlayerId}/topTenOrder`]: next,
            });
        },
        [roomId, myPlayerId]
    );

    const movePlayerInOrder = useCallback(
        (index, direction) => {
            if (!canEditSharedTurn && !canEditIndividual) return;
            const source = isIndividual ? myIndividualOrder : sharedPlayerOrder;
            const next = [...source];
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= next.length) return;

            if (interactionKind === 'turn-pick-move') {
                if (pickMoveIndex == null || index !== pickMoveIndex) return;
            }

            [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

            if (isIndividual) {
                persistIndividualOrder(next);
                return;
            }
            if (interactionKind === 'turn-pick-move') {
                persistSharedOrderOnly(next);
                setPickMoveIndex(targetIndex);
                return;
            }
            advanceSharedTurn(next);
        },
        [
            canEditSharedTurn,
            canEditIndividual,
            isIndividual,
            interactionKind,
            pickMoveIndex,
            myIndividualOrder,
            sharedPlayerOrder,
            persistIndividualOrder,
            persistSharedOrderOnly,
            advanceSharedTurn,
        ]
    );

    const performSwap = useCallback(
        (indexA, indexB) => {
            if (!canEditSharedTurn) return;
            const source = sharedPlayerOrder;
            const next = [...source];
            if (indexA < 0 || indexB < 0 || indexA >= next.length || indexB >= next.length) return;
            [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
            advanceSharedTurn(next);
        },
        [canEditSharedTurn, sharedPlayerOrder, advanceSharedTurn]
    );

    const handleSelectForSwap = useCallback(
        (index) => {
            if (!canEditSharedTurn) return;
            if (interactionKind === 'turn-pick-target') {
                if (swapSelection.length === 0) {
                    setSwapSelection([index]);
                    return;
                }
                const [src] = swapSelection;
                const targets = [src - 1, src + 1].filter(
                    (i) => i >= 0 && i < sharedPlayerOrder.length
                );
                if (targets.includes(index) && index !== src) {
                    performSwap(src, index);
                } else if (index === src) {
                    setSwapSelection([]);
                } else {
                    setSwapSelection([index]);
                }
                return;
            }
            if (interactionKind !== 'turn-swap') return;
            setSwapSelection((prev) => {
                if (prev.includes(index)) return prev.filter((i) => i !== index);
                const next = [...prev, index];
                if (next.length === 2) {
                    const [a, b] = next;
                    window.setTimeout(() => performSwap(a, b), 0);
                    return next;
                }
                return next;
            });
        },
        [canEditSharedTurn, interactionKind, swapSelection, sharedPlayerOrder.length, performSwap]
    );

    const handlePickMovePlayer = useCallback(
        (index) => {
            if (!canEditSharedTurn || interactionKind !== 'turn-pick-move') return;
            setPickMoveIndex((prev) => (prev === index ? null : index));
        },
        [canEditSharedTurn, interactionKind]
    );

    const finishPickMoveTurn = useCallback(() => {
        if (!canEditSharedTurn || interactionKind !== 'turn-pick-move') return;
        advanceTurnOnly();
    }, [canEditSharedTurn, interactionKind, advanceTurnOnly]);

    const markOrderingAgreed = useCallback(() => {
        if (!canEditSharedTurn || !supportsOrderingAgree(orderingMode)) return;
        update(ref(db), {
            [`rooms/${roomId}/gameState/orderingAgreed/${myPlayerId}`]: true,
        }).then(() => advanceTurnOnly());
    }, [canEditSharedTurn, orderingMode, roomId, myPlayerId, advanceTurnOnly]);

    const submitIndividualOrder = useCallback(() => {
        if (!canEditIndividual) return;
        update(ref(db), {
            [`rooms/${roomId}/private/${myPlayerId}/topTenSubmitted`]: true,
            [`rooms/${roomId}/gameState/orderingSubmitted/${myPlayerId}`]: true,
        });
    }, [canEditIndividual, roomId, myPlayerId]);

    const forceResetTable = useCallback(() => {
        if (isLegacy) {
            set(ref(db, `rooms/${roomId}/gameState`), defaultRoomState);
        } else {
            update(ref(db), buildTopTenResetUpdates(roomId));
        }
        resetCategoriesToAll();
        setShowSecret(false);
        setSwapSelection([]);
        setPickMoveIndex(null);
    }, [isLegacy, roomId, defaultRoomState, resetCategoriesToAll]);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        if (canManageGame && onCloseRoom) {
            onCloseRoom();
            return;
        }
        onLeave();
    }, [forceResetTable, canManageGame, onCloseRoom, onLeave]);

    const renderSecretContent = (word, rating) => (
        <>
            <h2 className="top-ten-secret-word">{word ?? '…'}</h2>
            {rating != null && (
                <p className="top-ten-secret-rating">
                    Twoja intensywność: <strong>{rating}</strong> / 10
                </p>
            )}
            {roomData.categoryName && (
                <p className="impostor-cat-info">
                    Kategoria: <span className="text-gold">{roomData.categoryName}</span>
                </p>
            )}
        </>
    );

    const orderingHintKey = useMemo(() => {
        if (isIndividual) {
            return myIndividualSubmitted
                ? 'gameSetup.topTen.orderingHints.individualDone'
                : 'gameSetup.topTen.orderingHints.individual';
        }
        const hintByKind = {
            'turn-step': 'gameSetup.topTen.orderingHints.turnStep',
            'turn-pick-move': 'gameSetup.topTen.orderingHints.turnPickMove',
            'turn-swap': 'gameSetup.topTen.orderingHints.turnSwap',
            'turn-pick-target': 'gameSetup.topTen.orderingHints.turnPickTarget',
        };
        return hintByKind[interactionKind] ?? 'gameSetup.topTen.orderingHints.watchOnly';
    }, [isIndividual, interactionKind, myIndividualSubmitted]);

    const swapTargetIndices = useMemo(() => {
        if (interactionKind !== 'turn-pick-target' || swapSelection.length !== 1) return [];
        const src = swapSelection[0];
        const targets = [];
        if (src > 0) targets.push(src - 1);
        if (src < sharedPlayerOrder.length - 1) targets.push(src + 1);
        return targets;
    }, [interactionKind, swapSelection, sharedPlayerOrder.length]);

    const individualScoreRows = useMemo(() => {
        if (!roomData.individualScores) return [];
        return activePlayerIds
            .map((pid) => ({
                playerId: pid,
                name: tablePlayers.find((p) => p.id === pid)?.name ?? 'Nieznany gracz',
                score: roomData.individualScores[pid],
            }))
            .filter((row) => row.score != null)
            .sort((a, b) => a.score - b.score);
    }, [roomData.individualScores, activePlayerIds, tablePlayers]);

    const trueOrder = useMemo(
        () => buildTrueOrderByRatings(ratingsByPlayerId),
        [ratingsByPlayerId]
    );

    return (
        <div className="top-ten">
            {roomData.phase === 'lobby' ? (
                <div>
                    <GameRules title={t('games.top-ten.name')}>
                        <GameRulesList gameId="top-ten" />
                    </GameRules>
                    {canManageGame && (
                        <CollapsibleSection
                            toggleLabel={t('gameSetup.topTen.settingsShow')}
                            toggleLabelOpen={t('gameSetup.topTen.settingsHide')}
                            defaultOpen
                        >
                            <TopTenModeSelector
                                value={roomSettings.orderingMode}
                                onChange={setOrderingModeSetting}
                                onBackToRoom={onBackToMenu}
                            />
                        </CollapsibleSection>
                    )}
                    <GameCategoryLobby
                        isHost={canManageGame}
                        categories={playableCategories}
                        selectedIds={selectedCategories}
                        onToggle={toggleCategory}
                        onStart={startGame}
                        startLabel={t('gameSetup.topTen.startButton')}
                        selectPrompt={t('gameLobby.selectCategories')}
                        guestWaitMessage={t('gameLobby.waitForHostTopTen')}
                        shareOptions={shareOptions}
                        canStart={selectedCategories.length > 0 && lobbyPlayerCount >= 2}
                    />
                    {canManageGame && lobbyPlayerCount < 2 && (
                        <p className="impostor-start-hint text-error">{t('gameSetup.topTen.needPlayers')}</p>
                    )}
                    {startErrorKey && (
                        <p className="impostor-start-hint text-error">{t(startErrorKey)}</p>
                    )}
                </div>
            ) : (
                <div>
                    {startingPlayerName && roomData.phase !== 'ordering' && (
                        <p className="impostor-starting-player">
                            Zaczyna pokazy: <strong>{startingPlayerName}</strong>
                        </p>
                    )}

                    {roomData.phase !== 'lobby' && (
                        <p className="top-ten-mode-badge">
                            {t(`gameSetup.topTen.orderingModes.${orderingMode}.title`)}
                        </p>
                    )}

                    {roomData.phase === 'peeking' && (
                        <>
                            <p className="impostor-peeking-header">Sprawdź hasło i swoją liczbę</p>
                            {myLinkedGuests.length > 0 ? (
                                <SharedPhoneRoleReveal
                                    resetEpoch={roleRevealEpoch}
                                    guests={myLinkedGuests}
                                    ownerPeekClassName="top-ten-bg-revealed"
                                    renderOwnerReveal={() =>
                                        renderSecretContent(myDisplayWord, myDisplayRating)
                                    }
                                    renderGuestReveal={(guest) => {
                                        const guestWord = usePrivacy
                                            ? getPrivateWord(privateRoles[guest.id])
                                            : roomData.word;
                                        const guestRating = usePrivacy
                                            ? getPrivateRating(privateRoles[guest.id])
                                            : (roomData.ratings?.[guest.id] ?? null);
                                        return renderSecretContent(guestWord, guestRating);
                                    }}
                                />
                            ) : (
                                <>
                                    <div
                                        onMouseDown={() => setShowSecret(true)}
                                        onMouseUp={() => setShowSecret(false)}
                                        onMouseLeave={() => setShowSecret(false)}
                                        onTouchStart={() => setShowSecret(true)}
                                        onTouchEnd={() => setShowSecret(false)}
                                        className={`peek-panel ${showSecret ? 'top-ten-bg-revealed' : 'impostor-bg-hidden'}`}
                                    >
                                        {!showSecret ? (
                                            <h3 className="peek-hidden-text">
                                                Kliknij i przytrzymaj, aby zobaczyć hasło
                                            </h3>
                                        ) : (
                                            renderSecretContent(myDisplayWord, myDisplayRating)
                                        )}
                                    </div>
                                    <p className="impostor-secret-warning">Ukryj ekran przed innymi!</p>
                                </>
                            )}
                            <p className="top-ten-phase-hint">
                                Pokaż innym, jak robisz to na swoją skalę — bez mówienia liczby.
                            </p>
                        </>
                    )}

                    {roomData.phase === 'acting' && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">Czas na pokaz!</h2>
                            <p className="impostor-discussing-desc">
                                Ekrany zablokowane. Każdy pokazuje swoją intensywność — bez podawania liczby.
                            </p>
                        </div>
                    )}

                    {roomData.phase === 'ordering' && (
                        <div className="top-ten-ordering-panel">
                            <h2 className="impostor-discussing-title">
                                {isIndividual ? 'Twoja tabela' : 'Wspólna tabela'}
                            </h2>
                            <p className="top-ten-phase-hint">{t(orderingHintKey)}</p>
                            {isIndividual && canManageGame && (
                                <p className="top-ten-phase-hint">
                                    {t('gameSetup.topTen.submittedProgress', {
                                        done: submittedCount,
                                        total: activePlayerIds.length,
                                    })}
                                </p>
                            )}
                            {isTurnBased && turnPlayerName && (
                                <p className="top-ten-turn-banner">
                                    {isMyOrderingTurn
                                        ? t('gameSetup.topTen.yourTurn')
                                        : t('gameSetup.topTen.waitTurn', { name: turnPlayerName })}
                                </p>
                            )}
                            {supportsOrderingAgree(orderingMode) && (
                                <p className="top-ten-phase-hint">
                                    {allAgreed
                                        ? t('gameSetup.topTen.allAgreed')
                                        : t('gameSetup.topTen.agreedProgress', {
                                            done: agreedCount,
                                            total: activePlayerIds.length,
                                        })}
                                </p>
                            )}
                            {!canEditOrder && roomData.phase === 'ordering' && isIndividual && myIndividualSubmitted && (
                                <p className="top-ten-phase-hint">
                                    {t('gameSetup.topTen.orderingHints.individualDone')}
                                </p>
                            )}
                            <TopTenOrderingBoard
                                playerOrder={displayOrder}
                                tablePlayers={tablePlayers}
                                interactionKind={isIndividual ? 'individual' : interactionKind}
                                canEdit={canEditOrder}
                                currentTurnPlayerId={orderingTurnPlayerId}
                                onMoveUp={(index) => movePlayerInOrder(index, -1)}
                                onMoveDown={(index) => movePlayerInOrder(index, 1)}
                                pickMoveIndex={pickMoveIndex}
                                onPickMovePlayer={handlePickMovePlayer}
                                swapSelection={swapSelection}
                                swapTargetIndices={swapTargetIndices}
                                onSelectForSwap={handleSelectForSwap}
                            />
                            {canEditSharedTurn && interactionKind === 'turn-pick-move' && (
                                <button
                                    type="button"
                                    className="btn-accent top-ten-finish-pick-move"
                                    onClick={finishPickMoveTurn}
                                >
                                    {t('gameSetup.topTen.finishPickMove')}
                                </button>
                            )}
                            {canEditSharedTurn && supportsOrderingAgree(orderingMode) && (
                                <button
                                    type="button"
                                    className="btn-accent top-ten-agree-order"
                                    onClick={markOrderingAgreed}
                                >
                                    {t('gameSetup.topTen.agreeOrder')}
                                </button>
                            )}
                            {canEditIndividual && (
                                <button
                                    type="button"
                                    className="btn-accent top-ten-submit-order"
                                    onClick={submitIndividualOrder}
                                >
                                    {t('gameSetup.topTen.submitOrder')}
                                </button>
                            )}
                        </div>
                    )}

                    {roomData.phase === 'revealed' && (
                        <div className="top-ten-reveal-panel">
                            <h2 className="impostor-discussing-title">Prawdziwe liczby</h2>
                            <ol className="top-ten-reveal-list">
                                {trueOrder.map((playerId) => {
                                    const player = tablePlayers.find((p) => p.id === playerId);
                                    return (
                                        <li key={playerId} className="top-ten-reveal-row">
                                            <span className="top-ten-reveal-rating">
                                                {ratingsByPlayerId[playerId] ?? '?'}
                                            </span>
                                            <span>{player?.name ?? 'Nieznany gracz'}</span>
                                        </li>
                                    );
                                })}
                            </ol>

                            {isIndividual && individualScoreRows.length > 0 && (
                                <div className="top-ten-scores">
                                    <h3 className="top-ten-scores__title">{t('gameSetup.topTen.scoresTitle')}</h3>
                                    <p className="top-ten-phase-hint">{t('gameSetup.topTen.scoresHint')}</p>
                                    <ol className="top-ten-scores__list">
                                        {individualScoreRows.map((row, index) => (
                                            <li key={row.playerId} className="top-ten-scores__row">
                                                <span className="top-ten-scores__place">{index + 1}.</span>
                                                <span>{row.name}</span>
                                                <span className="top-ten-scores__value">
                                                    {t('gameSetup.topTen.scorePoints', { score: row.score })}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            )}

                            {!isIndividual && (
                                <p className="top-ten-phase-hint">{t('gameSetup.topTen.compareShared')}</p>
                            )}
                        </div>
                    )}

                    {!isRoomLocked && roomData.phase !== 'peeking' && roomData.phase !== 'lobby' && (
                        <div className="role-replay-bar">
                            {canManageGame ? (
                                <button type="button" className="btn-role-replay" onClick={replaySecrets}>
                                    Pokaż hasła ponownie (wszyscy)
                                </button>
                            ) : (
                                myLinkedGuests.length > 0 && (
                                    <p className="impostor-replay-hint">
                                        Zapomniałeś liczby? Poproś hosta o ponowny podgląd.
                                    </p>
                                )
                            )}
                        </div>
                    )}

                    {canManageGame && (
                        <div className="game-host-controls top-ten-host-controls">
                            {roomData.phase === 'peeking' && (
                                <button type="button" className="btn-impostor-discuss" onClick={() => setPhase('acting')}>
                                    Rozpocznij pokazy (zablokuj podgląd)
                                </button>
                            )}
                            {roomData.phase === 'acting' && (
                                <button type="button" className="btn-impostor-discuss" onClick={() => setPhase('ordering')}>
                                    Przejdź do układania kolejności
                                </button>
                            )}
                            {roomData.phase === 'ordering' && (
                                <button type="button" className="btn-impostor-discuss" onClick={revealRatings}>
                                    Odsłoń prawdziwe liczby
                                </button>
                            )}
                            {(roomData.phase === 'revealed' || roomData.phase === 'ordering') && (
                                <ConfirmButton onClick={drawNextWord} text="Losuj kolejne hasło" />
                            )}
                            <HostShareOptions shareOptions={shareOptions} />
                            <ConfirmButton onClick={forceResetTable} text="Zakończ rundę i wróć do lobby" />
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={canManageGame ? handleEndGame : onLeave}
                    text={canManageGame ? 'Zamknij pokój' : 'Wyjdź z pokoju'}
                />
            </div>
        </div>
    );
}

export default TopTen;
