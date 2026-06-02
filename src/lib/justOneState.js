import { get, ref } from 'firebase/database';
import { db } from './firebase';
import { update as rtdbUpdate } from './rtdb';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
import {
    allClueGiversSubmitted,
    roomPlayersRecordToSubmitList,
    buildJustOneNormCounts,
    getVisibleCluesForListener,
    normalizeJustOneWord,
    resolveJustOneClueGivers,
    buildJustOneSubmittedMap,
    filterJustOneRequiredClueGivers,
    isJustOneClueSubmitted,
} from '../games/just-one/justOneUtils';

export const JUST_ONE_PHASE_LOBBY = 'lobby';
export const JUST_ONE_PHASE_PEEKING = 'peeking';
export const JUST_ONE_PHASE_SUBMITTING = 'submitting';
export const JUST_ONE_PHASE_REVEALED = 'revealed';
export const JUST_ONE_PHASE_WON = 'won';

export const DEFAULT_JUST_ONE_GAME_STATE = {
    isGameStarted: false,
    phase: JUST_ONE_PHASE_LOBBY,
    roundNumber: 0,
    listenerId: null,
    previousListenerId: null,
    roleRevealEpoch: 0,
    categoryName: '',
    categoryIds: [],
    submitted: {},
    clueHistory: [],
    currentClues: null,
    visibleClues: null,
    autoRound: true,
    awaitingNextRound: false,
};

export function canAdvanceJustOneRound(gameState) {
    if (!gameState?.isGameStarted) return false;
    if (gameState.phase === JUST_ONE_PHASE_WON) return false;
    return (
        gameState.phase === JUST_ONE_PHASE_PEEKING
        || gameState.phase === JUST_ONE_PHASE_SUBMITTING
        || gameState.phase === JUST_ONE_PHASE_REVEALED
    );
}

export function shouldPauseForJustOneNextRound(gameState) {
    if (!canAdvanceJustOneRound(gameState)) return false;
    return gameState?.autoRound === false;
}

/**
 * Po zebraniu podpowiedzi: zapisuje turę w historii i od razu startuje kolejną (wpisywanie).
 * @param {string} roomId
 * @param {string[]} clueGiverIds
 */
export async function fetchAndRevealJustOneRound(roomId) {
    const basePath = `rooms/${roomId}`;
    const roomSnap = await get(ref(db, basePath));
    const room = roomSnap.val();
    const gameState = room?.gameState || {};
    const hostOnly = room?.hostOnly || {};

    if (gameState.phase !== JUST_ONE_PHASE_SUBMITTING) {
        return {};
    }

    const lockedRound = Number(gameState.roundNumber) || 1;

    const activeIds = getJustOneActivePlayerIds(room?.players);
    const { listenerId: currentListenerId, clueGiverIds } = resolveJustOneClueGivers(
        activeIds,
        gameState.listenerId,
        gameState.previousListenerId
    );

    const currentClues = {};
    await Promise.all(
        clueGiverIds.map(async (playerId) => {
            const snap = await get(ref(db, `${basePath}/private/${playerId}/justOneClue`));
            currentClues[playerId] = typeof snap.val() === 'string' ? snap.val().trim() : '';
        })
    );

    const recheckSnap = await get(ref(db, `${basePath}/gameState`));
    const recheck = recheckSnap.val() || {};
    if (
        recheck.phase !== JUST_ONE_PHASE_SUBMITTING
        || (Number(recheck.roundNumber) || 1) !== lockedRound
    ) {
        return {};
    }

    const roundNumber = lockedRound;

    const clueHistory =
        Array.isArray(gameState.clueHistory) ? [...gameState.clueHistory] : [];
    const nextHistory = [...clueHistory, { round: roundNumber, clues: { ...currentClues } }];

    const playerIds = activeIds;
    const secretWord = typeof hostOnly.word === 'string' ? hostOnly.word : '';

    if (!secretWord || !currentListenerId || playerIds.length < 3) {
        const visibleClues = getVisibleCluesForListener(clueHistory, currentClues);
        const privateClears = {};
        for (const playerId of clueGiverIds) {
            privateClears[`${basePath}/private/${playerId}/justOneClue`] = null;
        }
        return {
            [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_REVEALED,
            [`${basePath}/gameState/currentClues`]: currentClues,
            [`${basePath}/gameState/visibleClues`]: visibleClues,
            [`${basePath}/gameState/clueHistory`]: nextHistory,
            [`${basePath}/gameState/submitted`]: {},
            [`${basePath}/gameState/awaitingNextRound`]: true,
            ...privateClears,
        };
    }

    const nextRoundNumber = roundNumber + 1;

    return {
        [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_SUBMITTING,
        [`${basePath}/gameState/roundNumber`]: nextRoundNumber,
        [`${basePath}/gameState/listenerId`]: currentListenerId,
        [`${basePath}/gameState/previousListenerId`]: currentListenerId,
        [`${basePath}/gameState/clueHistory`]: nextHistory,
        [`${basePath}/gameState/currentClues`]: null,
        [`${basePath}/gameState/visibleClues`]: null,
        [`${basePath}/gameState/submitted`]: buildJustOneSubmittedMap(currentListenerId),
        [`${basePath}/gameState/awaitingNextRound`]: false,
        ...buildJustOnePrivateWordPathUpdates(roomId, playerIds, currentListenerId, secretWord),
    };
}

/** Aktualizacja pól private/* (bez nadpisywania całego węzła — mniej konfliktów reguł RTDB). */
export function buildJustOnePrivateWordPathUpdates(roomId, playerIds, listenerId, secretWord) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    for (const playerId of playerIds) {
        const isListener = playerId === listenerId;
        updates[`${basePath}/private/${playerId}/isImpostor`] = false;
        updates[`${basePath}/private/${playerId}/word`] = isListener ? null : secretWord;
        updates[`${basePath}/private/${playerId}/justOneClue`] = null;
    }

    return updates;
}

/** Hasło w private/word (model jak Impostor) — tylko dla graczy podających podpowiedź. */
export function buildJustOnePrivateWordUpdates(roomId, playerIds, listenerId, secretWord) {
    const updates = {};
    const basePath = `rooms/${roomId}`;

    for (const playerId of playerIds) {
        const isListener = playerId === listenerId;
        updates[`${basePath}/private/${playerId}`] = {
            isImpostor: false,
            word: isListener ? null : secretWord,
        };
    }

    return updates;
}

export function buildJustOneStartUpdates(roomId, gameState, { word, chosenCatId, playerIds, listenerId }) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            isGameStarted: true,
            phase: JUST_ONE_PHASE_PEEKING,
            roleRevealEpoch: 1,
            ...gameState,
            autoRound: gameState.autoRound !== false,
            awaitingNextRound: false,
            submitted: {},
            clueHistory: [],
            currentClues: null,
            visibleClues: null,
        },
        [`${basePath}/hostOnly`]: { word, chosenCatId },
        ...buildJustOnePrivateWordUpdates(roomId, playerIds, listenerId, word),
    };
}

export function buildJustOneNextRoundUpdates(roomId, partialState, playerIds) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_SUBMITTING,
        [`${basePath}/gameState/roleRevealEpoch`]: partialState.roleRevealEpoch,
        [`${basePath}/gameState/listenerId`]: partialState.listenerId,
        [`${basePath}/gameState/roundNumber`]: partialState.roundNumber,
        [`${basePath}/gameState/categoryName`]: partialState.categoryName,
        [`${basePath}/gameState/categoryIds`]: partialState.categoryIds,
        [`${basePath}/gameState/submitted`]: buildJustOneSubmittedMap(partialState.listenerId),
        [`${basePath}/gameState/currentClues`]: null,
        [`${basePath}/gameState/visibleClues`]: null,
        [`${basePath}/gameState/awaitingNextRound`]: false,
        [`${basePath}/gameState/previousListenerId`]: partialState.previousListenerId,
        ...buildJustOnePrivateWordUpdates(
            roomId,
            playerIds,
            partialState.listenerId,
            partialState.word
        ),
    };
}

export function buildJustOneStartSubmittingUpdates(roomId, listenerId) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_SUBMITTING,
        [`${basePath}/gameState/submitted`]: buildJustOneSubmittedMap(listenerId),
    };
}

export function buildJustOneReplayWordUpdates(roomId, nextEpoch) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_PEEKING,
        [`${basePath}/gameState/roleRevealEpoch`]: nextEpoch,
    };
}

export function buildJustOneWonUpdates(roomId) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState/phase`]: JUST_ONE_PHASE_WON,
        [`${basePath}/gameState/awaitingNextRound`]: false,
    };
}

/** Aktywni gracze przy stole (bez wyrzuconych). */
export function getJustOneActivePlayerIds(playersRecord) {
    return Object.entries(playersRecord || {})
        .filter(([, player]) => player && player.isKicked !== true)
        .map(([playerId]) => playerId);
}

/**
 * @returns {Promise<{ updates: Record<string, unknown>, result: string }>}
 */
export async function buildJustOneSyncUpdates(roomId) {
    const basePath = `rooms/${roomId}`;
    const roomSnap = await get(ref(db, basePath));
    const room = roomSnap.val();

    if (!room?.gameState?.isGameStarted) {
        return { updates: {}, result: 'not_started' };
    }

    const gameState = room.gameState;
    const activeIds = getJustOneActivePlayerIds(room.players);
    const { listenerId: resolvedListenerId, clueGiverIds } = resolveJustOneClueGivers(
        activeIds,
        gameState.listenerId,
        gameState.previousListenerId
    );
    const updates = {};

    if (resolvedListenerId && resolvedListenerId !== gameState.listenerId) {
        updates[`${basePath}/gameState/listenerId`] = resolvedListenerId;
        updates[`${basePath}/gameState/previousListenerId`] = resolvedListenerId;
    }

    const submitted =
        gameState.submitted && typeof gameState.submitted === 'object'
            ? { ...gameState.submitted }
            : {};

    for (const playerId of Object.keys(submitted)) {
        if (!clueGiverIds.includes(playerId)) {
            updates[`${basePath}/gameState/submitted/${playerId}`] = null;
            delete submitted[playerId];
        }
    }

    const privateRoot = room.private && typeof room.private === 'object' ? room.private : {};
    for (const playerId of Object.keys(privateRoot)) {
        if (!clueGiverIds.includes(playerId)) {
            updates[`${basePath}/private/${playerId}/justOneClue`] = null;
        }
    }

    if (gameState.phase !== JUST_ONE_PHASE_SUBMITTING) {
        return {
            updates,
            result: Object.keys(updates).length > 0 ? 'cleaned' : 'noop',
        };
    }

    if (clueGiverIds.length === 0) {
        return { updates, result: 'noop' };
    }

    const tablePlayers = roomPlayersRecordToSubmitList(room.players);

    if (resolvedListenerId && !isJustOneClueSubmitted(submitted, resolvedListenerId, resolvedListenerId)) {
        updates[`${basePath}/gameState/submitted/${resolvedListenerId}`] = true;
        submitted[resolvedListenerId] = true;
    }

    for (const playerId of clueGiverIds) {
        if (!tablePlayers.some((p) => p.id === playerId)) {
            updates[`${basePath}/gameState/submitted/${playerId}`] = null;
            delete submitted[playerId];
        }
    }

    if (allClueGiversSubmitted(clueGiverIds, submitted, tablePlayers, resolvedListenerId)) {
        return {
            updates,
            result: 'ready_to_advance',
        };
    }

    const required = filterJustOneRequiredClueGivers(
        tablePlayers,
        clueGiverIds,
        resolvedListenerId
    );
    const pending = required.filter(
        (id) => !isJustOneClueSubmitted(submitted, id, resolvedListenerId)
    );

    return {
        updates,
        result:
            pending.length > 0
                ? `waiting:${pending.length}`
                : Object.keys(updates).length > 0
                  ? 'cleaned'
                  : 'noop',
    };
}

/**
 * Przejście do kolejnej tury — wywołuje host (zapis RTDB z priority, ponowienia przy opóźnieniu sync).
 * @param {string} roomId
 * @param {{ assumeSubmittedId?: string, maxAttempts?: number }} [options]
 * @returns {Promise<{ advanced: boolean, reason: string }>}
 */
export async function tryAdvanceJustOneIfReady(roomId, options = {}) {
    const { assumeSubmittedId, maxAttempts = 6 } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const basePath = `rooms/${roomId}`;
        const roomSnap = await get(ref(db, basePath));
        const room = roomSnap.val();
        const gameState = room?.gameState || {};

        if (!gameState.isGameStarted || gameState.phase !== JUST_ONE_PHASE_SUBMITTING) {
            return {
                advanced: Boolean(gameState.isGameStarted && gameState.phase !== JUST_ONE_PHASE_SUBMITTING),
                reason: 'not_submitting',
            };
        }

        const activeIds = getJustOneActivePlayerIds(room?.players);
        const { listenerId: resolvedListenerId, clueGiverIds } = resolveJustOneClueGivers(
            activeIds,
            gameState.listenerId,
            gameState.previousListenerId
        );

        if (!clueGiverIds.length) {
            return { advanced: false, reason: 'no_clue_givers' };
        }

        const submitted =
            gameState.submitted && typeof gameState.submitted === 'object'
                ? { ...gameState.submitted }
                : {};
        if (assumeSubmittedId) {
            submitted[assumeSubmittedId] = true;
        }
        if (resolvedListenerId) {
            submitted[resolvedListenerId] = true;
        }

        const tablePlayers = roomPlayersRecordToSubmitList(room.players);

        if (!allClueGiversSubmitted(clueGiverIds, submitted, tablePlayers, resolvedListenerId)) {
            if (attempt < maxAttempts - 1) {
                await sleep(180);
                continue;
            }
            const required = filterJustOneRequiredClueGivers(
                tablePlayers,
                clueGiverIds,
                resolvedListenerId
            );
            const pending = required.filter(
                (id) => !isJustOneClueSubmitted(submitted, id, resolvedListenerId)
            );
            return {
                advanced: false,
                reason: pending.length ? `pending:${pending.join(',')}` : 'pending_unknown',
            };
        }

        const revealUpdates = await fetchAndRevealJustOneRound(roomId);
        if (!revealUpdates || Object.keys(revealUpdates).length === 0) {
            if (attempt < maxAttempts - 1) {
                await sleep(180);
                continue;
            }
            return { advanced: false, reason: 'reveal_skipped' };
        }

        try {
            await rtdbUpdate(ref(db), revealUpdates, { priority: true, minUiMs: 0 });
            return { advanced: true, reason: 'revealed' };
        } catch (err) {
            const msg = err?.message || String(err);
            if (attempt < maxAttempts - 1) {
                await sleep(220);
                continue;
            }
            return { advanced: false, reason: `err:${msg}` };
        }
    }

    return { advanced: false, reason: 'max_attempts' };
}

/**
 * Admin NEXT — następna tura (wpisywanie podpowiedzi) lub odsłonięcie + przejście dalej.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function buildJustOneAdvanceRoundUpdatesFromRoom(roomId) {
    const basePath = `rooms/${roomId}`;
    const roomSnap = await get(ref(db, basePath));
    const room = roomSnap.val();
    const gameState = room?.gameState || {};

    if (!gameState.isGameStarted || gameState.phase === JUST_ONE_PHASE_WON) {
        return null;
    }

    const activeIds = getJustOneActivePlayerIds(room?.players);
    const hostOnly = room?.hostOnly || {};
    const secretWord = typeof hostOnly.word === 'string' ? hostOnly.word : '';
    if (!secretWord || activeIds.length < 3) {
        return null;
    }

    const { listenerId: currentListenerId, clueGiverIds } = resolveJustOneClueGivers(
        activeIds,
        gameState.listenerId,
        gameState.previousListenerId
    );
    const tablePlayers = roomPlayersRecordToSubmitList(room.players);
    const submitted =
        gameState.submitted && typeof gameState.submitted === 'object'
            ? gameState.submitted
            : {};

    if (gameState.phase === JUST_ONE_PHASE_PEEKING) {
        return buildJustOneStartSubmittingUpdates(roomId, currentListenerId);
    }

    if (
        gameState.phase === JUST_ONE_PHASE_SUBMITTING
        && allClueGiversSubmitted(clueGiverIds, submitted, tablePlayers, currentListenerId)
    ) {
        return fetchAndRevealJustOneRound(roomId);
    }

    if (!currentListenerId) return null;

    const nextRound = (Number(gameState.roundNumber) || 1) + 1;

    return buildJustOneNextRoundUpdates(
        roomId,
        {
            listenerId: currentListenerId,
            roundNumber: nextRound,
            categoryName: gameState.categoryName || '',
            categoryIds: gameState.categoryIds || [],
            word: secretWord,
            chosenCatId: hostOnly.chosenCatId,
            previousListenerId: currentListenerId,
            roleRevealEpoch: (Number(gameState.roleRevealEpoch) || 1) + 1,
        },
        activeIds
    );
}

/** Czy słowo było już użyte w historii (dla walidacji UI). */
export function isClueNormUsedInHistory(clueHistory, candidate) {
    const norm = normalizeJustOneWord(candidate);
    if (!norm) return false;
    return buildJustOneNormCounts(clueHistory).has(norm);
}
