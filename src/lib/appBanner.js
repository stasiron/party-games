export const APP_BANNER_DISMISS_KEY = 'partyGames.appBanner.dismissedVersion.v1';

export function loadDismissedBannerVersion() {
    if (typeof window === 'undefined') return 0;
    try {
        return Number(window.localStorage.getItem(APP_BANNER_DISMISS_KEY) || 0);
    } catch {
        return 0;
    }
}

export function saveDismissedBannerVersion(updatedAt) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(APP_BANNER_DISMISS_KEY, String(updatedAt));
    } catch {
        /* private mode */
    }
}

/** Tekst bannera dla bieżącego locale z fallbackiem na PL. */
export function resolveBannerContent(banner, locale = 'pl') {
    const lang = locale === 'en' ? 'en' : 'pl';
    const title = banner?.title?.[lang] || banner?.title?.pl || '';
    const body = banner?.body?.[lang] || banner?.body?.pl || '';
    return {
        title: String(title).trim(),
        body: String(body).trim(),
    };
}

export function hasBannerContent(banner, locale = 'pl') {
    const { title, body } = resolveBannerContent(banner, locale);
    return title.length > 0 || body.length > 0;
}

export function shouldShowAppBanner(banner, dismissedVersion, locale = 'pl') {
    if (!banner?.enabled || !banner.updatedAt) return false;
    if (dismissedVersion === banner.updatedAt) return false;
    return hasBannerContent(banner, locale);
}
