import { useState, useCallback, useMemo, useEffect } from 'react';

/** Domyślnie wszystkie kategorie/poziomy zaznaczone; reset przywraca pełną listę. */
export function useCategorySelection(playableItems) {
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

    const toggleId = useCallback((id) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }, []);

    const resetToAll = useCallback(() => {
        setSelectedIds(allIds);
    }, [allIds]);

    return { selectedIds, toggleId, resetToAll, allIds };
}
