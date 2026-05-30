import { findThemePreset } from './themePresets.js';

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return [0, 0, 0];
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
    ];
}

function rgbToHex(r, g, b) {
    const clamp = (c) => Math.round(Math.max(0, Math.min(255, c)));
    return `#${[clamp(r), clamp(g), clamp(b)]
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')}`;
}

function relativeLuminance([r, g, b]) {
    const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function saturation([r, g, b]) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    if (max === min) return 0;
    const l = (max + min) / 2;
    const d = max - min;
    return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

export function averageGradientLuminance(stops) {
    if (!Array.isArray(stops) || stops.length === 0) return 0;
    const sum = stops.reduce((acc, hex) => acc + relativeLuminance(hexToRgb(hex)), 0);
    return sum / stops.length;
}

export function isLightTheme(stops) {
    return averageGradientLuminance(stops) > 0.38;
}

function accentAlpha(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darkenHex(hex, factor = 0.52) {
    const rgb = hexToRgb(hex);
    return rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor);
}

function darkenIfNeeded(hex) {
    const rgb = hexToRgb(hex);
    if (relativeLuminance(rgb) > 0.55) {
        return darkenHex(hex, 0.52);
    }
    return hex;
}

function borderColorForCard(hex, stops, light) {
    const bgLum = averageGradientLuminance(stops);
    const border = darkenHex(hex, light ? 0.38 : 0.72);
    const borderLum = relativeLuminance(hexToRgb(border));
    if (Math.abs(bgLum - borderLum) < 0.22) {
        return light ? '#1a1a2e' : '#ffffff';
    }
    return border;
}

export function pickTruthDareColors(stops, light) {
    if (!Array.isArray(stops) || stops.length === 0) {
        return { truth: '#a855f7', dare: '#f43f5e' };
    }
    if (light) {
        let truth = darkenIfNeeded(stops[stops.length - 1]);
        let dare = darkenIfNeeded(stops[0]);
        if (truth === dare && stops.length >= 3) {
            dare = darkenIfNeeded(stops[Math.floor(stops.length / 2)]);
        }
        return { truth, dare };
    }
    let truth = darkenIfNeeded(stops[stops.length - 1]);
    let dare = darkenIfNeeded(stops.length >= 2 ? stops[1] : stops[0]);
    if (truth === dare && stops.length >= 3) {
        dare = darkenIfNeeded(stops[0]);
    }
    return { truth, dare };
}

export function pickAccentHex(stops) {
    if (!Array.isArray(stops) || stops.length === 0) return '#d63384';
    const candidates = stops.length > 1 ? stops.slice(1) : stops;
    let accent = candidates[0];
    let bestSat = -1;
    for (const hex of candidates) {
        const sat = saturation(hexToRgb(hex));
        if (sat > bestSat) {
            bestSat = sat;
            accent = hex;
        }
    }
    return darkenIfNeeded(accent);
}

const SURFACE_BY_BRIGHTNESS = {
    dark: {
        glassBg: 'rgba(255, 255, 255, 0.05)',
        glassBorder: 'rgba(255, 255, 255, 0.2)',
        panelDark: 'rgba(0, 0, 0, 0.3)',
        textPrimary: '#ffffff',
        textOnGlass: '#ffffff',
        btnGlassHover: 'rgba(255, 255, 255, 0.15)',
        overlayPanelBg: 'rgba(18, 24, 42, 0.78)',
        overlayPanelText: '#ffffff',
        overlayPanelBorder: 'rgba(255, 255, 255, 0.22)',
        overlayToggleBg: 'rgba(255, 255, 255, 0.12)',
        overlayToggleBorder: 'rgba(255, 255, 255, 0.24)',
        overlayToggleText: '#ffffff',
        overlayHintText: 'rgba(255, 255, 255, 0.82)',
        overlayInputBg: 'rgba(255, 255, 255, 0.14)',
    },
    light: {
        glassBg: 'rgba(0, 0, 0, 0.14)',
        glassBorder: 'rgba(0, 0, 0, 0.32)',
        panelDark: 'rgba(0, 0, 0, 0.42)',
        textPrimary: '#1a1a2e',
        textOnGlass: '#1a1a2e',
        btnGlassHover: 'rgba(0, 0, 0, 0.22)',
        overlayPanelBg: 'rgba(255, 255, 255, 0.68)',
        overlayPanelText: '#1a1a2e',
        overlayPanelBorder: 'rgba(255, 255, 255, 0.45)',
        overlayToggleBg: 'rgba(255, 255, 255, 0.52)',
        overlayToggleBorder: 'rgba(0, 0, 0, 0.16)',
        overlayToggleText: '#1a1a2e',
        overlayHintText: 'rgba(26, 26, 46, 0.82)',
        overlayInputBg: 'rgba(255, 255, 255, 0.88)',
    },
};

/** Niebieski + pomarańcz zamiast czerwony/zielony — czytelne przy deuteranopii/protanopii. */
const DALTONISM = {
    accent: '#0ea5e9',
    orange: '#fb923c',
    truth: '#2563eb',
    dare: '#fb923c',
    danger: '#fb923c',
    success: '#0ea5e9',
    successBright: '#38bdf8',
    surface: {
        glassBg: 'rgba(15, 23, 42, 0.72)',
        glassBorder: 'rgba(251, 146, 60, 0.65)',
        panelDark: 'rgba(15, 23, 42, 0.85)',
        textPrimary: '#f1f5f9',
        textOnGlass: '#f1f5f9',
        btnGlassHover: 'rgba(251, 146, 60, 0.28)',
        overlayPanelBg: 'rgba(15, 23, 42, 0.88)',
        overlayPanelText: '#f8fafc',
        overlayPanelBorder: 'rgba(251, 146, 60, 0.75)',
        overlayToggleBg: 'rgba(30, 41, 59, 0.9)',
        overlayToggleBorder: 'rgba(251, 146, 60, 0.8)',
        overlayToggleText: '#f8fafc',
        overlayHintText: 'rgba(254, 215, 170, 0.9)',
        overlayInputBg: 'rgba(30, 41, 59, 0.95)',
    },
};

/** Czarny UI, twarde niebieskie obramowania, bez miękkich gradientów w elementach. */
const CYBER = {
    accent: '#00b4ff',
    truth: '#00d4ff',
    dare: '#3b9eff',
    danger: '#ff6b35',
    success: '#00b4ff',
    successBright: '#5ce1ff',
    surface: {
        glassBg: 'rgba(0, 0, 0, 0.82)',
        glassBorder: 'rgba(255, 255, 255, 0.28)',
        panelDark: 'rgba(0, 0, 0, 0.92)',
        textPrimary: '#f0f8ff',
        textOnGlass: '#ffffff',
        btnGlassHover: 'rgba(36, 36, 36, 0.96)',
        overlayPanelBg: 'rgba(0, 0, 0, 0.94)',
        overlayPanelText: '#f0f8ff',
        overlayPanelBorder: 'rgba(255, 255, 255, 0.24)',
        overlayToggleBg: 'rgba(0, 0, 0, 0.9)',
        overlayToggleBorder: 'rgba(255, 255, 255, 0.28)',
        overlayToggleText: '#ffffff',
        overlayHintText: 'rgba(220, 230, 240, 0.88)',
        overlayInputBg: 'rgba(0, 0, 0, 0.9)',
    },
};

function setSemanticColors(root, colors) {
    root.style.setProperty('--color-accent', colors.accent);
    root.style.setProperty('--color-truth', colors.truth);
    root.style.setProperty('--color-dare', colors.dare);
    root.style.setProperty('--color-danger', colors.danger);
    root.style.setProperty('--color-success', colors.success);
    root.style.setProperty('--color-success-bright', colors.successBright);
}

function setBugOptionTokens(root, accent, { light = false, hardBorders = false, surface = null } = {}) {
    if (hardBorders && surface) {
        root.style.setProperty('--bug-panel-bg', surface.overlayPanelBg);
        root.style.setProperty('--bug-panel-border', surface.overlayPanelBorder);
        root.style.setProperty('--bug-option-bg', surface.overlayToggleBg);
        root.style.setProperty('--bug-option-border', surface.overlayToggleBorder);
        root.style.setProperty('--bug-option-text', surface.overlayToggleText);
        root.style.setProperty('--bug-option-hover-bg', 'rgba(36, 36, 36, 0.96)');
        root.style.setProperty('--bug-option-hover-border', accentAlpha(accent, 0.45));
        root.style.setProperty('--bug-option-active-bg', accentAlpha(accent, 0.2));
        root.style.setProperty('--bug-option-active-border', accentAlpha('#00d4ff', 0.78));
        root.style.setProperty('--bug-option-active-ring', accentAlpha(accent, 0.38));
        root.style.setProperty('--bug-option-check-bg', accentAlpha(accent, 0.24));
        return;
    }

    if (hardBorders) {
        return;
    }

    const panelBg = surface?.overlayPanelBg;
    const panelBorder = surface?.overlayPanelBorder;
    const toggleBg = surface?.overlayToggleBg;
    const toggleBorder = surface?.overlayToggleBorder;
    const toggleText = surface?.overlayToggleText;

    if (panelBg) {
        root.style.setProperty('--bug-panel-bg', panelBg);
        root.style.setProperty('--bug-panel-border', panelBorder);
    }
    if (toggleBg) {
        root.style.setProperty('--bug-option-bg', toggleBg);
        root.style.setProperty('--bug-option-border', toggleBorder);
        root.style.setProperty('--bug-option-text', toggleText);
        root.style.setProperty('--bug-option-hover-bg', accentAlpha(accent, light ? 0.28 : 0.26));
        root.style.setProperty('--bug-option-hover-border', toggleBorder);
        root.style.setProperty('--bug-option-active-bg', accentAlpha(accent, light ? 0.38 : 0.42));
        root.style.setProperty('--bug-option-active-border', accent);
        root.style.setProperty('--bug-option-active-ring', accentAlpha(accent, light ? 0.72 : 0.68));
        root.style.setProperty('--bug-option-check-bg', accentAlpha(accent, light ? 0.32 : 0.28));
        return;
    }

    root.style.setProperty('--bug-option-bg', light ? 'rgba(255, 255, 255, 0.62)' : accentAlpha(accent, 0.16));
    root.style.setProperty('--bug-option-border', light ? accentAlpha(accent, 0.55) : accentAlpha(accent, 0.58));
    root.style.setProperty('--bug-option-text', light ? '#1a1a2e' : '#ffffff');
    root.style.setProperty('--bug-option-hover-bg', accentAlpha(accent, light ? 0.28 : 0.26));
    root.style.setProperty('--bug-option-active-bg', accentAlpha(accent, light ? 0.38 : 0.42));
    root.style.setProperty('--bug-option-active-border', accent);
    root.style.setProperty('--bug-option-active-ring', accentAlpha(accent, light ? 0.72 : 0.68));
}

function setSurfaceTokens(root, surface, accent, stops, options = {}) {
    const { light = false, hardBorders = false, fixedSemanticColors = false } = options;
    const truth = options.truth ?? accent;
    const dare = options.dare ?? accent;

    root.style.setProperty('--glass-bg', surface.glassBg);
    root.style.setProperty('--glass-border', surface.glassBorder);
    root.style.setProperty('--panel-dark', surface.panelDark);
    root.style.setProperty('--text-primary', surface.textPrimary);
    root.style.setProperty('--text-on-glass', surface.textOnGlass);
    root.style.setProperty('--btn-glass-hover', surface.btnGlassHover);
    root.style.setProperty('--overlay-panel-bg', surface.overlayPanelBg);
    root.style.setProperty('--overlay-panel-text', surface.overlayPanelText);
    root.style.setProperty('--overlay-panel-border', surface.overlayPanelBorder);
    root.style.setProperty('--overlay-toggle-bg', surface.overlayToggleBg);
    root.style.setProperty('--overlay-toggle-border', surface.overlayToggleBorder);
    root.style.setProperty('--overlay-toggle-text', surface.overlayToggleText);
    root.style.setProperty('--overlay-hint-text', surface.overlayHintText);
    root.style.setProperty('--overlay-input-bg', surface.overlayInputBg);

    const selectedBg = hardBorders ? 'rgba(0, 0, 0, 0.95)' : accentAlpha(accent, light ? 0.22 : 0.28);
    const selectedRing = hardBorders ? accent : accentAlpha(accent, light ? 0.85 : 0.55);

    root.style.setProperty('--category-selected-bg', selectedBg);
    root.style.setProperty('--category-selected-ring', selectedRing);
    root.style.setProperty('--category-btn-text', light ? surface.overlayPanelText : '#ffffff');
    root.style.setProperty('--category-btn-desc', light ? surface.overlayHintText : 'rgba(255, 255, 255, 0.9)');
    root.style.setProperty('--category-unselected-bg', surface.overlayToggleBg);
    root.style.setProperty('--category-unselected-border', surface.overlayToggleBorder);
    root.style.setProperty('--category-unselected-text', surface.overlayToggleText);
    root.style.setProperty('--accent-hover-bg', accentAlpha(accent, hardBorders ? 0.25 : light ? 0.32 : 0.35));
    root.style.setProperty('--accent-muted-bg', accentAlpha(accent, hardBorders ? 0.12 : 0.22));
    root.style.setProperty('--accent-panel-bg', accentAlpha(accent, hardBorders ? 0.08 : 0.18));
    root.style.setProperty(
        '--settings-panel-bg',
        hardBorders ? surface.overlayPanelBg : `linear-gradient(135deg, ${accentAlpha(accent, 0.72)}, ${accentAlpha(accent, 0.12)})`
    );
    root.style.setProperty('--guest-chip-active-bg', accentAlpha(accent, hardBorders ? 0.35 : light ? 0.55 : 0.45));

    setBugOptionTokens(root, accent, { light, hardBorders, surface });

    const useFixedCards = hardBorders || fixedSemanticColors;
    root.style.setProperty('--tod-truth-border', useFixedCards ? truth : borderColorForCard(truth, stops, light));
    root.style.setProperty('--tod-dare-border', useFixedCards ? dare : borderColorForCard(dare, stops, light));
    root.style.setProperty(
        '--tod-card-outline',
        useFixedCards ? accent : light ? 'rgba(26, 26, 46, 0.4)' : 'rgba(255, 255, 255, 0.35)'
    );
    root.style.setProperty(
        '--tod-truth-bg',
        useFixedCards ? accentAlpha(truth, 0.4) : accentAlpha(truth, light ? 0.22 : 0.42)
    );
    root.style.setProperty(
        '--tod-dare-bg',
        useFixedCards ? accentAlpha(dare, 0.4) : accentAlpha(dare, light ? 0.22 : 0.42)
    );
}

function applyDaltonismTheme(root, stops) {
    const palette = DALTONISM;
    const blue = palette.accent;
    const orange = palette.orange;

    root.dataset.themeSurface = 'dark';
    setSemanticColors(root, palette);
    setSurfaceTokens(root, palette.surface, blue, stops, {
        light: false,
        fixedSemanticColors: true,
        truth: palette.truth,
        dare: palette.dare,
    });

    root.style.setProperty('--color-orange', orange);
    root.style.setProperty('--category-selected-bg', accentAlpha(orange, 0.32));
    root.style.setProperty('--category-selected-ring', blue);
    root.style.setProperty('--category-unselected-border', orange);
    root.style.setProperty('--category-unselected-bg', accentAlpha(orange, 0.22));
    root.style.setProperty('--glass-border', accentAlpha(orange, 0.7));
    root.style.setProperty('--overlay-panel-border', orange);
    root.style.setProperty('--overlay-toggle-border', orange);
    root.style.setProperty('--accent-hover-bg', accentAlpha(orange, 0.42));
    root.style.setProperty('--accent-muted-bg', accentAlpha(orange, 0.35));
    root.style.setProperty('--accent-panel-bg', accentAlpha(orange, 0.28));
    root.style.setProperty('--btn-glass-hover', accentAlpha(orange, 0.32));
    root.style.setProperty('--guest-chip-active-bg', accentAlpha(blue, 0.5));
    root.style.setProperty(
        '--settings-panel-bg',
        `linear-gradient(145deg, ${accentAlpha(orange, 0.55)} 0%, ${accentAlpha(blue, 0.55)} 55%, ${accentAlpha(orange, 0.45)} 100%)`
    );
    root.style.setProperty('--tod-truth-border', palette.truth);
    root.style.setProperty('--tod-dare-border', orange);
    root.style.setProperty('--tod-truth-bg', accentAlpha(palette.truth, 0.38));
    root.style.setProperty('--tod-dare-bg', accentAlpha(orange, 0.55));
    root.style.setProperty('--tod-card-outline', accentAlpha(orange, 0.65));
}

function applyCyberTheme(root, stops) {
    const palette = CYBER;
    root.dataset.themeSurface = 'dark';
    setSemanticColors(root, palette);
    setSurfaceTokens(root, palette.surface, palette.accent, stops, {
        light: false,
        hardBorders: true,
        truth: palette.truth,
        dare: palette.dare,
    });

    const accent = palette.accent;
    root.style.setProperty('--cyber-ui-bg', 'rgba(0, 0, 0, 0.9)');
    root.style.setProperty('--cyber-ui-bg-hover', 'rgba(36, 36, 36, 0.96)');
    root.style.setProperty('--cyber-ui-border', 'rgba(255, 255, 255, 0.28)');
    root.style.setProperty('--cyber-ui-selected-bg', accentAlpha(accent, 0.22));
    root.style.setProperty('--cyber-ui-selected-border', accentAlpha('#00d4ff', 0.78));
    root.style.setProperty('--cyber-ui-selected-ring', accentAlpha(accent, 0.42));
    root.style.setProperty('--category-selected-bg', accentAlpha(accent, 0.22));
    root.style.setProperty('--category-selected-ring', accentAlpha('#00d4ff', 0.65));
    root.style.setProperty('--category-unselected-bg', 'var(--cyber-ui-bg)');
    root.style.setProperty('--category-unselected-border', 'var(--cyber-ui-border)');
    root.style.setProperty('--category-unselected-text', '#ffffff');
    root.style.setProperty('--category-btn-text', '#ffffff');
    root.style.setProperty('--category-btn-desc', 'rgba(235, 240, 245, 0.92)');
    root.style.setProperty('--accent-muted-bg', 'rgba(36, 36, 36, 0.96)');
    root.style.setProperty('--accent-hover-bg', accentAlpha(accent, 0.16));
    root.style.setProperty('--guest-chip-active-bg', accentAlpha(accent, 0.22));
    root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.28)');
    setBugOptionTokens(root, accent, { hardBorders: true, surface: palette.surface });
}

function applyDefaultTheme(root, stops) {
    const light = isLightTheme(stops);
    const surface = light ? SURFACE_BY_BRIGHTNESS.light : SURFACE_BY_BRIGHTNESS.dark;
    const accent = pickAccentHex(stops);
    const { truth, dare } = pickTruthDareColors(stops, light);

    root.dataset.themeSurface = light ? 'light' : 'dark';
    setSemanticColors(root, {
        accent,
        truth,
        dare,
        danger: '#ff4444',
        success: '#16a34a',
        successBright: '#44ff44',
    });
    setSurfaceTokens(root, surface, accent, stops, { light, truth, dare });
}

/**
 * @param {HTMLElement} root
 * @param {import('./themePresets.js').themePresets[number] | string[] | { stops: string[], id?: string, kind?: string }} presetOrStops
 */
export function applyThemeSurface(root, presetOrStops) {
    let preset;
    if (Array.isArray(presetOrStops)) {
        preset = { ...findThemePreset('default'), stops: presetOrStops };
    } else if (presetOrStops?.stops) {
        preset = presetOrStops;
    } else {
        preset = findThemePreset('default');
    }
    const stops = preset.stops;

    root.dataset.themeId = preset.id ?? 'default';
    root.removeAttribute('data-theme-kind');
    if (preset.kind && preset.kind !== 'default') {
        root.dataset.themeKind = preset.kind;
    } else {
        root.removeAttribute('data-theme-kind');
    }

    if (preset.kind === 'daltonism') {
        applyDaltonismTheme(root, stops);
        return;
    }
    if (preset.kind === 'cyber') {
        applyCyberTheme(root, stops);
        return;
    }
    applyDefaultTheme(root, stops);
}
