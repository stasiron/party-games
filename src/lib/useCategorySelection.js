import { useState, useCallback, useMemo } from 'react';

/** Domyślnie wszystkie kategorie/poziomy zaznaczone; reset przywraca pełną listę. */
export function useCategorySelection(playableItems) {
    const allIds = useMemo(
        () => (playableItems ?? []).map((item) => item.id),
        [playableItems]
    );

    const [selectedIds, setSelectedIds] = useState(() => allIds);

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
