/** Presety gradientu tła + opcjonalny rodzaj palety UI. */
export const themePresets = [
    { id: 'default', label: '🟣 Fioletowy (domyślny)', stops: ['#0a0f1e', '#2a113a', '#8c215e'] },
    { id: 'sunrise', label: '🌅 Żółto-zielono-niebieski', stops: ['#f8ff70', '#3ad59f', '#0099ff'] },
    { id: 'sunset', label: '🌇 Różowo-pomarańczowy', stops: ['#ff5f6d', '#ffb56b', '#ffd47f'] },
    { id: 'forest', label: '🌲 Zielono-granatowy', stops: ['#1b5e20', '#0d3b66', '#1e88e5'] },
    {
        id: 'daltonism',
        label: '♿ Daltonizm (niebieski + pomarańcz)',
        stops: ['#151c2c', '#9a3412', '#1e3a5f'],
        kind: 'daltonism',
    },
    {
        id: 'cyber',
        label: '⬛ Czarny + niebieskie obramowania',
        stops: ['#000000', '#000000', '#0a0a12'],
        kind: 'cyber',
    },
];

export function findThemePreset(id) {
    return themePresets.find((p) => p.id === id) || themePresets[0];
}
