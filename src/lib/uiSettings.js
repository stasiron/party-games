export const UI_SETTINGS_KEY = 'partyGames.uiSettings.v1';

export function loadUiSettings() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function notifyUiSettingsChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('partyGames:uiSettings'));
}

export function isTouchPrimaryDevice() {
    if (typeof window === 'undefined') return false;
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

/** Stały interwał ping — domyślnie wyłączony (szczególnie na telefonach). */
export function isContinuousPingEnabled() {
    const stored = loadUiSettings();
    if (typeof stored?.continuousPingEnabled === 'boolean') {
        return stored.continuousPingEnabled;
    }
    return false;
}

/** Ręczny tryb oszczędny sieci z ustawień UI. */
export function isPowerSaveModeEnabled() {
    return loadUiSettings()?.powerSaveMode === true;
}
