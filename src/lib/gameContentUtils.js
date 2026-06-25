/** Etykieta zapasowa, gdy kategoria jest tylko w puli treści (questions/words/content). */
function labelFromId(id) {
    return id
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Łączy wpisy z tablicy `categories` z kluczami w mapie treści.
 * Nowa kategoria w JSON pojawi się w UI, jeśli jest w `categories` LUB ma niepustą treść pod swoim `id`.
 */
function mergeCategories(listed, contentMap, hasContent) {
    const listedArr = listed || [];
    const byId = new Map();

    for (const cat of listedArr) {
        if (hasContent(cat.id, contentMap)) {
            byId.set(cat.id, cat);
        }
    }

    if (contentMap && typeof contentMap === 'object') {
        for (const id of Object.keys(contentMap)) {
            if (!byId.has(id) && hasContent(id, contentMap)) {
                byId.set(id, { id, name: labelFromId(id), desc: '' });
            }
        }
    }

    const ordered = [];
    const seen = new Set();

    for (const cat of listedArr) {
        if (byId.has(cat.id) && !seen.has(cat.id)) {
            ordered.push(byId.get(cat.id));
            seen.add(cat.id);
        }
    }

    for (const id of Object.keys(contentMap || {}).sort()) {
        if (byId.has(id) && !seen.has(id)) {
            ordered.push(byId.get(id));
            seen.add(id);
        }
    }

    return ordered;
}

export function getNeverHaveIEverCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.questions,
        (id, map) => Array.isArray(map?.[id]) && map[id].length > 0
    );
}

export function getImpostorCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.words,
        (id, map) => Array.isArray(map?.[id]) && map[id].length > 0
    );
}

export function getTruthOrDareCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.content,
        (id, map) => {
            const pack = map?.[id];
            if (!pack) return false;
            const truths = pack.truth?.length ?? 0;
            const dares = pack.dare?.length ?? 0;
            return truths + dares > 0;
        }
    );
}

export function getDarkStoriesDifficulties(section) {
    return mergeCategories(
        section?.difficulties,
        section?.stories,
        (id, map) => {
            const pool = map?.[id];
            return Array.isArray(pool) && pool.length > 0;
        }
    );
}

export function getWhoWouldRatherCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.dilemmas,
        (id, map) => Array.isArray(map?.[id]) && map[id].length > 0
    );
}

export function getKtoNajpredzejCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.questions,
        (id, map) => Array.isArray(map?.[id]) && map[id].length > 0
    );
}

export function getSingItCategories(section) {
    return mergeCategories(
        section?.categories,
        section?.words,
        (id, map) => Array.isArray(map?.[id]) && map[id].length > 0
    );
}

export function getCategoryLabel(categories, id) {
    const found = categories.find((c) => c.id === id);
    return found?.name ?? labelFromId(id);
}

/** Scala pule treści z wielu kategorii w jedną talię (używane przy starcie gry). */
export function buildDeckFromContentMap(categoryIds, contentMap) {
    const items = [];
    for (const catId of categoryIds) {
        const pool = contentMap?.[catId];
        if (Array.isArray(pool)) {
            items.push(...pool);
        }
    }
    return items;
}
