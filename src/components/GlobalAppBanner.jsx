import { useCallback, useState } from 'react';
import {
    loadDismissedBannerVersion,
    resolveBannerContent,
    saveDismissedBannerVersion,
    shouldShowAppBanner,
} from '../lib/appBanner';
import { useLocale } from '../locales/LocaleContext';

function GlobalAppBanner({ banner }) {
    const { locale, t } = useLocale();
    const [dismissedVersion, setDismissedVersion] = useState(loadDismissedBannerVersion);

    const dismiss = useCallback(() => {
        if (!banner?.updatedAt) return;
        saveDismissedBannerVersion(banner.updatedAt);
        setDismissedVersion(banner.updatedAt);
    }, [banner?.updatedAt]);

    if (!shouldShowAppBanner(banner, dismissedVersion, locale)) {
        return null;
    }

    const { title, body } = resolveBannerContent(banner, locale);

    return (
        <aside className="app-global-banner" role="note" aria-live="polite">
            {title ? <p className="app-global-banner__title">{title}</p> : null}
            {body ? <p className="app-global-banner__text">{body}</p> : null}
            <div className="app-global-banner__actions">
                <button type="button" className="app-global-banner__dismiss" onClick={dismiss}>
                    {t('appBanner.dismiss')}
                </button>
            </div>
        </aside>
    );
}

export default GlobalAppBanner;
