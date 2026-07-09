import { get, ref } from 'firebase/database';
import { db } from '../../lib/firebase';
import {
    allPlayersSubmitted,
    allWordsMatch,
    appendPlayerWordHistory,
    normalizeTelepathyWord,
} from './telepathyUtils';

export const TELEPATHY_PHASE_LOBBY = 'lobby';
export const TELEPATHY_PHASE_SUBMITTING = 'submitting';
export const TELEPATHY_PHASE_REVEALED = 'revealed';
export const TELEPATHY_PHASE_WON = 'won';

export const DEFAULT_TELEPATHY_GAME_STATE = {
    isGameStarted: false,
    phase: TELEPATHY_PHASE_LOBBY,
    roundNumber: 0,
    usedWords: [],
    submitted: {},
    revealedWords: null,
    playerWordHistory: {},
    autoRound: true,
    awaitingNextRound: false,
};

/** Czy można ręcznie ruszyć kolejną turę (faza odsłonięcia, gra nie wygrana). */
export function canAdvanceTelepathyRound(gameState) {
    if (!gameState?.isGameStarted) return false;
    if (gameState.phase === TELEPATHY_PHASE_WON) return false;
    return gameState.phase === TELEPATHY_PHASE_REVEALED;
}

/** Po odsłonięciu — czekamy na hosta (auto wyłączone). */
export function shouldPauseForTelepathyNextRound(gameState) {
    if (!canAdvanceTelepathyRound(gameState)) return false;
    return gameState?.autoRound === false;
}

/**
 * Odczyt słów z private/ i zapis publicznego stanu po turze.
 * @param {string} roomId
 * @param {string[]} participantIds
 * @param {string[]} usedWords — już zużyte (znormalizowane)
 */
export async function fetchAndRevealTelepathyRound(roomId, participantIds, usedWords = []) {
    const revealedWords = {};
    const basePath = `rooms/${roomId}`;

    const historySnap = await get(ref(db, `${basePath}/gameState/playerWordHistory`));
    let playerWordHistory =
        historySnap.val() && typeof historySnap.val() === 'object' ? { ...historySnap.val() } : {};

    await Promise.all(
        participantIds.map(async (playerId) => {
            const snap = await get(ref(db, `${basePath}/private/${playerId}/telepathyWord`));
            revealedWords[playerId] = typeof snap.val() === 'string' ? snap.val().trim() : '';
            playerWordHistory = appendPlayerWordHistory(
                playerWordHistory,
                playerId,
                revealedWords[playerId]
            );
        })
    );

    const nextUsed = [...usedWords];
    const seenNorm = new Set(usedWords);
    for (const raw of Object.values(revealedWords)) {
        const norm = normalizeTelepathyWord(raw);
        if (norm && !seenNorm.has(norm)) {
            seenNorm.add(norm);
            nextUsed.push(norm);
        }
    }

    const privateClears = {};
    for (const playerId of participantIds) {
        privateClears[`${basePath}/private/${playerId}/telepathyWord`] = null;
    }

    const everyoneMatched = allWordsMatch(revealedWords, participantIds);

    const autoRoundSnap = await get(ref(db, `${basePath}/gameState/autoRound`));
    const autoRound = autoRoundSnap.val() !== false;

    const updates = {
        [`${basePath}/gameState/phase`]: everyoneMatched
            ? TELEPATHY_PHASE_WON
            : TELEPATHY_PHASE_REVEALED,
        [`${basePath}/gameState/revealedWords`]: revealedWords,
        [`${basePath}/gameState/playerWordHistory`]: playerWordHistory,
        [`${basePath}/gameState/usedWords`]: nextUsed,
        [`${basePath}/gameState/submitted`]: {},
        ...privateClears,
    };

    if (!everyoneMatched && !autoRound) {
        updates[`${basePath}/gameState/awaitingNextRound`] = true;
    } else {
        updates[`${basePath}/gameState/awaitingNextRound`] = false;
    }

    return updates;
}

export function buildTelepathyStartUpdates(roomId, { autoRound = true } = {}) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState`]: {
            isGameStarted: true,
            phase: TELEPATHY_PHASE_SUBMITTING,
            roundNumber: 1,
            usedWords: [],
            submitted: {},
            revealedWords: null,
            playerWordHistory: {},
            autoRound: autoRound !== false,
            awaitingNextRound: false,
        },
        [`${basePath}/private`]: null,
        [`${basePath}/hostOnly`]: null,
    };
}

export function buildTelepathyNextRoundUpdates(roomId, roundNumber) {
    const basePath = `rooms/${roomId}`;
    return {
        [`${basePath}/gameState/phase`]: TELEPATHY_PHASE_SUBMITTING,
        [`${basePath}/gameState/roundNumber`]: roundNumber,
        [`${basePath}/gameState/submitted`]: {},
        [`${basePath}/gameState/revealedWords`]: null,
        [`${basePath}/gameState/awaitingNextRound`]: false,
    };
}

/** Pełny zapis następnej tury (czyści prywatne słowa graczy). */
export function buildTelepathyAdvanceRoundUpdates(roomId, roundNumber, participantIds) {
    const basePath = `rooms/${roomId}`;
    const updates = buildTelepathyNextRoundUpdates(roomId, roundNumber);
    for (const playerId of participantIds) {
        updates[`${basePath}/private/${playerId}/telepathyWord`] = null;
    }
    return updates;
}

/**
 * @param {string} roomId
 * @param {string[]} participantIds
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildTelepathyAdvanceRoundUpdatesFromRoom(roomId, participantIds) {
    const snap = await get(ref(db, `rooms/${roomId}/gameState/roundNumber`));
    const roundNumber = Number(snap.val()) || 1;
    return buildTelepathyAdvanceRoundUpdates(roomId, roundNumber + 1, participantIds);
}

/** Aktywni gracze przy stole (bez wyrzuconych). */
export function getTelepathyActivePlayerIds(playersRecord) {
    return Object.entries(playersRecord || {})
        .filter(([, player]) => player && player.isKicked !== true)
        .map(([playerId]) => playerId);
}

/**
 * Porządkuje stan Telepatii po wyrzuceniu / rozłączeniu i ewentualnie odsłania turę.
 * @returns {Promise<{ updates: Record<string, unknown>, result: 'revealed' | 'cleaned' | 'noop' | 'not_started' | 'not_submitting' }>}
 */
export async function buildTelepathySyncUpdates(roomId) {
    const basePath = `rooms/${roomId}`;
    const roomSnap = await get(ref(db, basePath));
    const room = roomSnap.val();

    if (!room?.gameState?.isGameStarted) {
        return { updates: {}, result: 'not_started' };
    }

    const gameState = room.gameState;
    const activeIds = getTelepathyActivePlayerIds(room.players);
    const updates = {};

    const submitted =
        gameState.submitted && typeof gameState.submitted === 'object'
            ? { ...gameState.submitted }
            : {};

    for (const playerId of Object.keys(submitted)) {
        if (!activeIds.includes(playerId)) {
            updates[`${basePath}/gameState/submitted/${playerId}`] = null;
            delete submitted[playerId];
        }
    }

    const privateRoot = room.private && typeof room.private === 'object' ? room.private : {};
    for (const playerId of Object.keys(privateRoot)) {
        if (!activeIds.includes(playerId)) {
            updates[`${basePath}/private/${playerId}/telepathyWord`] = null;
        }
    }

    if (gameState.phase !== TELEPATHY_PHASE_SUBMITTING) {
        return {
            updates,
            result: Object.keys(updates).length > 0 ? 'cleaned' : 'noop',
        };
    }

    if (activeIds.length === 0) {
        return { updates, result: 'noop' };
    }

    if (allPlayersSubmitted(activeIds, submitted)) {
        const usedWords = Array.isArray(gameState.usedWords) ? gameState.usedWords : [];
        const revealUpdates = await fetchAndRevealTelepathyRound(roomId, activeIds, usedWords);
        return {
            updates: { ...updates, ...revealUpdates },
            result: 'revealed',
        };
    }

    return {
        updates,
        result: Object.keys(updates).length > 0 ? 'cleaned' : 'noop',
    };
}
