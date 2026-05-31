import { loadUiSettings } from './uiSettings';

export const LOBBY_FILTERS_KEY = 'partyGames.lobbyFilters.v1';

export const DEFAULT_LOBBY_FILTERS = {
    gameId: '',
    minOnline: 0,
    hideClosed: true,
    enabled: true,
    panelOpen: false,
};

export function loadLobbyFilters() {
    if (typeof window === 'undefined') {
        return { ...DEFAULT_LOBBY_FILTERS };
    }
    try {
        const raw = window.localStorage.getItem(LOBBY_FILTERS_KEY);
        if (!raw) return { ...DEFAULT_LOBBY_FILTERS };
        const parsed = JSON.parse(raw);
        return {
            gameId: String(parsed?.gameId || ''),
            minOnline: Math.max(0, Number(parsed?.minOnline || 0)),
            hideClosed: parsed?.hideClosed !== false,
            enabled: parsed?.enabled !== false,
            panelOpen: parsed?.panelOpen === true,
        };
    } catch {
        return { ...DEFAULT_LOBBY_FILTERS };
    }
}

export function saveLobbyFilters(filters) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LOBBY_FILTERS_KEY, JSON.stringify(filters));
    } catch {
        /* ignore */
    }
}

/** Opóźnienie tylko kolejnych aktualizacji listy (pierwsza jest natychmiastowa). */
export function getRoomsPublicDebounceMs() {
    const stored = loadUiSettings();
    if (stored?.powerSaveMode === true) return 280;
    return 120;
}
