import { firebaseConnection } from './firebase';

export const LOW_POWER_CLASS = 'low-power';

export function isLowPowerDevice() {
    if (typeof window === 'undefined') return false;
    return firebaseConnection.mode === 'emulator';
}

export function applyLowPowerClass() {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle(LOW_POWER_CLASS, isLowPowerDevice());
}

/** Po dołączeniu — nie wyrzucać przy chwilowym braku wpisu w RTDB (wolny Android / emulator). */
export function getJoinGraceMs() {
    return isLowPowerDevice() ? 12000 : 5000;
}

/** Zanim uznajemy że gracz zniknął z bazy (ms). */
export function getPresenceMissingGraceMs() {
    return isLowPowerDevice() ? 3500 : 2000;
}

export function getPlayersDebounceMs() {
    return isLowPowerDevice() ? 300 : 120;
}

export function getGameStateDebounceMs() {
    return isLowPowerDevice() ? 400 : 80;
}

/** Min. odstęp między zapisami RTDB na emulatorze (Java na Malinie). */
export function getMinWriteGapMs() {
    return isLowPowerDevice() ? 220 : 0;
}

/** Odstęp między odczytami w kolejce (losowanie gracza + ping). */
export function getMinReadGapMs() {
    return isLowPowerDevice() ? 70 : 0;
}

/** Krótkie opóźnienie po kliknięciu w grze — Malina nie dostaje lawiny update. */
export function getMinUiSyncMs() {
    return isLowPowerDevice() ? 420 : 0;
}
