/** Czy PWA (manifest + service worker) jest włączone w tym buildzie. */
export const PWA_ENABLED = import.meta.env.VITE_ENABLE_PWA !== 'false';

export const PWA_INSTALL_DISMISS_KEY = 'partyGames.pwaInstallDismissed.v1';

export function isStandaloneDisplay() {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true
    );
}

export function isIosSafari() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isApple = /iPad|iPhone|iPod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isApple) return false;
    return !/CriOS|FxiOS|EdgiOS/i.test(ua);
}

export function canShowInstallPrompt() {
    return PWA_ENABLED && !isStandaloneDisplay();
}
