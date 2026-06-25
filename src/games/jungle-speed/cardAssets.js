/** Kolory kart — tylko UI; logika matchu używa wyłącznie `shape`. */
export const JUNGLE_CARD_COLORS = {
    red: '#e74c3c',
    blue: '#3498db',
    green: '#2ecc71',
    yellow: '#f1c40f',
    purple: '#9b59b6',
};

const shapeSvgRaw = import.meta.glob('../../assets/jungle-speed/shapes/*.svg', {
    eager: true,
    query: '?raw',
    import: 'default',
});

const customCardUrl = import.meta.glob('../../assets/jungle-speed/cards/*.svg', {
    eager: true,
    query: '?url',
    import: 'default',
});

function fileBaseName(path) {
    const name = path.split('/').pop() || path.split('\\').pop() || '';
    return name.replace(/\.svg$/i, '');
}

const shapeRawById = Object.fromEntries(
    Object.entries(shapeSvgRaw).map(([path, raw]) => [fileBaseName(path), raw])
);

const customUrlByCardId = Object.fromEntries(
    Object.entries(customCardUrl).map(([path, url]) => [fileBaseName(path), url])
);

export function getShapeSvgRaw(shape) {
    return shapeRawById[shape] || null;
}

export function getCustomCardUrl(cardId) {
    if (!cardId) return null;
    return customUrlByCardId[cardId] || null;
}

export function getCardFillColor(color) {
    return JUNGLE_CARD_COLORS[color] || '#ffffff';
}
