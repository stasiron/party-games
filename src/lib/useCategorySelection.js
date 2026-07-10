import { useState, useCallback, useMemo, useEffect } from 'react';

/** Domyślnie wszystkie kategorie/poziomy zaznaczone; opcjonalnie przywraca ostatni zestaw z gry. */
export function useCategorySelection(playableItems, { lastPlayedCategoryIds } = {}) {
    const allIds = useMemo(
        () => (playableItems ?? []).map((item) => item.id),
        [playableItems]
    );

    const [selectedIds, setSelectedIds] = useState(() => allIds);

    useEffect(() => {
        setSelectedIds((prev) => {
            if (allIds.length === 0) {
                return prev.length === 0 ? prev : [];
            }
            const valid = prev.filter((id) => allIds.includes(id));
            if (valid.length > 0) return valid;
            return allIds;
        });
    }, [allIds]);

    useEffect(() => {
        if (!Array.isArray(lastPlayedCategoryIds) || lastPlayedCategoryIds.length === 0) return;
        setSelectedIds((prev) => {
            const valid = lastPlayedCategoryIds.filter((id) => allIds.includes(id));
            if (valid.length === 0) return prev;
            if (
                valid.length === prev.length &&
                valid.every((id) => prev.includes(id))
            ) {
                return prev;
            }
            return valid;
        });
    }, [lastPlayedCategoryIds, allIds]);

    const toggleId = useCallback((id) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }, []);

    const resetToAll = useCallback(() => {
        setSelectedIds(allIds);
    }, [allIds]);

    const restoreFromIds = useCallback((ids) => {
        setSelectedIds((prev) => {
            const valid = (ids ?? []).filter((id) => allIds.includes(id));
            return valid.length > 0 ? valid : prev;
        });
    }, [allIds]);

    return { selectedIds, toggleId, resetToAll, restoreFromIds, allIds };
}
