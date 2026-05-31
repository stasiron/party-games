import { firebaseConnection } from './firebase';
import { isPowerSaveModeEnabled } from './uiSettings';

export const LOW_POWER_CLASS = 'low-power';

export function isLowPowerDevice() {
    if (typeof window === 'undefined') return false;
    return firebaseConnection.mode === 'emulator';
}

function getNetworkInformation() {
    if (typeof navigator === 'undefined') return null;
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

/** Emulator Pi, saveData, wolna sieć lub ręczny tryb oszczędny. */
export function shouldConserveNetwork() {
    if (typeof window === 'undefined') return false;
    if (isLowPowerDevice()) return true;
    if (isPowerSaveModeEnabled()) return true;
    const conn = getNetworkInformation();
    if (conn?.saveData) return true;
    const effectiveType = String(conn?.effectiveType || '');
    if (effectiveType === '2g' || effectiveType === 'slow-2g') return true;
    return false;
}

export function applyLowPowerClass() {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle(
        LOW_POWER_CLASS,
        isLowPowerDevice() || shouldConserveNetwork()
    );
}

/** Po dołączeniu — nie wyrzucać przy chwilowym braku wpisu w RTDB (wolny Android / emulator). */
export function getJoinGraceMs() {
    return isLowPowerDevice() ? 12000 : 5000;
}

/** Zanim uznajemy że gracz zniknął z bazy (ms). */
export function getPresenceMissingGraceMs() {
    if (shouldConserveNetwork()) return 4500;
    return isLowPowerDevice() ? 3500 : 2000;
}

export function getPlayersDebounceMs() {
    if (isLowPowerDevice()) return 360;
    if (shouldConserveNetwork()) return 400;
    return 120;
}

export function getGameStateDebounceMs() {
    if (isLowPowerDevice()) return 480;
    if (shouldConserveNetwork()) return 520;
    return 80;
}

/** Min. odstęp między zapisami w PartBox Sync. */
export function getMinWriteGapMs() {
    return isLowPowerDevice() ? 35 : 0;
}

/** Odstęp między odczytami w kolejce (join/ping). */
export function getMinReadGapMs() {
    return isLowPowerDevice() ? 25 : 0;
}

/** Krótkie opóźnienie UI po akcji — gracz widzi synchronizację. */
export function getMinUiSyncMs() {
    return isLowPowerDevice() ? 180 : 0;
}

/** Heartbeat gracza gdy karta jest widoczna. */
export function getHeartbeatIntervalMs() {
    if (shouldConserveNetwork()) return 180 * 1000;
    return 90 * 1000;
}

/** Heartbeat gdy karta w tle — max ~1 zapis na 3 min. */
export function getHiddenHeartbeatIntervalMs() {
    return 180 * 1000;
}
