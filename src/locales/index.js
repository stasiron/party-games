import pl from './pl.json';
import en from './en.json';

export const DEFAULT_LOCALE = 'pl';

export const SUPPORTED_LOCALES = [
    { id: 'pl', label: 'Polski', flag: '🇵🇱' },
    { id: 'en', label: 'English', flag: '🇬🇧' },
];

const UI_MESSAGES = { pl, en };

export function getUiMessages(locale) {
    return UI_MESSAGES[locale] ?? UI_MESSAGES[DEFAULT_LOCALE];
}

export function resolveLocaleId(locale) {
    if (locale && UI_MESSAGES[locale]) return locale;
    return DEFAULT_LOCALE;
}

export function detectInitialLocale() {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    try {
        const raw = window.localStorage.getItem('partyGames.uiSettings.v1');
        if (raw) {
            const stored = JSON.parse(raw)?.locale;
            if (stored && UI_MESSAGES[stored]) return stored;
        }
    } catch {
        /* ignore */
    }
    return DEFAULT_LOCALE;
}

function getNested(obj, path) {
    return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

export function interpolate(template, vars = {}) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

/**
 * @param {object} messages
 * @param {string} key — np. "lobby.guest.title"
 * @param {Record<string, string|number>} [vars]
 * @param {string} [fallback]
 */
export function translate(messages, key, vars, fallback = '') {
    const value = getNested(messages, key);
    if (typeof value === 'string') {
        return vars ? interpolate(value, vars) : value;
    }
    return fallback || key;
}

export function createTranslator(messages) {
    return (key, vars, fallback) => translate(messages, key, vars, fallback);
}

/** Lista zasad gry z locale (tablica stringów). */
export function getGameRules(messages, gameId) {
    const rules = messages?.games?.[gameId]?.rules;
    return Array.isArray(rules) ? rules : [];
}
