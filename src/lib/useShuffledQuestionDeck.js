import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { set } from './rtdb';
import { db } from './firebase';
import { useRoomGameState } from './useRoomGameState';
import { usePiGameSession } from './usePiGameSession';
import { shuffleArray } from './shuffle';
import { DECK_VERSION, deckStateFingerprint, resolveDeckFromState } from './deckStateUtils';

const DEFAULT_DECK_STATE = {
    isGameStarted: false,
    shuffledQuestions: [],
    currentQuestionIndex: 0,
};

/**
 * Wspólna logika gier „talia pytań”: kategorie → tasowanie → indeks w RTDB.
 * Nowy format (deckVersion 1): categoryIds + order (indeksy) zamiast pełnej talii w RTDB.
 * @param {string} roomId
 * @param {{
 *   buildDeckFromCategoryIds: (categoryIds: string[]) => unknown[],
 *   getCategoryIds: () => string[],
 *   onResetCategories?: () => void,
 *   indexKey?: string,
 *   legacyDeckKey?: string,
 *   extraStartFields?: Record<string, unknown>,
 *   getExtraStartFields?: () => Record<string, unknown>,
 *   additionalState?: Record<string, unknown>,
 *   fingerprintExtra?: (data: object) => string,
 * }} options
 */
export function useShuffledQuestionDeck(roomId, {
    buildDeckFromCategoryIds,
    getCategoryIds,
    onResetCategories,
    indexKey = 'currentQuestionIndex',
    legacyDeckKey = 'shuffledQuestions',
    extraStartFields = {},
    getExtraStartFields,
    additionalState = {},
    fingerprintExtra,
}) {
    const defaultRoomState = useMemo(
        () => ({ ...DEFAULT_DECK_STATE, [indexKey]: 0, ...additionalState, ...extraStartFields }),
        [indexKey, additionalState, extraStartFields]
    );
    const fingerprintGetter = useCallback(
        (data) => deckStateFingerprint(data, {
            indexKey,
            legacyDeckKey,
            extra: fingerprintExtra,
        }),
        [indexKey, legacyDeckKey, fingerprintExtra]
    );
    const roomData = useRoomGameState(roomId, defaultRoomState, {
        mergeDefaults: true,
        getFingerprint: fingerprintGetter,
    });
    usePiGameSession(roomData.isGameStarted);

    const resolvedDeck = useMemo(
        () => resolveDeckFromState(roomData, buildDeckFromCategoryIds, { legacyDeckKey }),
        [roomData, buildDeckFromCategoryIds, legacyDeckKey]
    );

    const deckLength = resolvedDeck.length;
    const currentIndex = roomData[indexKey] ?? 0;

    const startGame = useCallback(() => {
        const categoryIds = getCategoryIds();
        const baseDeck = buildDeckFromCategoryIds(categoryIds);
        const order = shuffleArray(baseDeck.map((_, i) => i));
        set(ref(db, `rooms/${roomId}/gameState`), {
            isGameStarted: true,
            deckVersion: DECK_VERSION,
            categoryIds,
            order,
            [indexKey]: 0,
            ...extraStartFields,
            ...getExtraStartFields?.(),
        });
    }, [buildDeckFromCategoryIds, getCategoryIds, roomId, indexKey, extraStartFields, getExtraStartFields]);

    const forceResetTable = useCallback(() => {
        set(ref(db, `rooms/${roomId}/gameState`), null);
        onResetCategories?.();
    }, [roomId, onResetCategories]);

    const nextQuestion = useCallback(() => {
        if (currentIndex < deckLength - 1) {
            set(ref(db, `rooms/${roomId}/gameState/${indexKey}`), currentIndex + 1);
        }
    }, [currentIndex, deckLength, roomId, indexKey]);

    const prevQuestion = useCallback(() => {
        if (currentIndex > 0) {
            set(ref(db, `rooms/${roomId}/gameState/${indexKey}`), currentIndex - 1);
        }
    }, [currentIndex, roomId, indexKey]);

    const currentQuestion = resolvedDeck[currentIndex];
    const isLastQuestion = deckLength > 0 && currentIndex >= deckLength - 1;
    const isFirstQuestion = currentIndex <= 0;

    return {
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
    };
}
