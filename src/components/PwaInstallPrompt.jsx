import { useCallback, useEffect, useState } from 'react';
import { firebaseConnection } from '../lib/firebase';
import {
    PWA_INSTALL_DISMISS_KEY,
    canShowInstallPrompt,
    isIosSafari,
} from '../lib/pwa';
import { useLocale } from '../locales/LocaleContext';

function loadDismissed() {
    try {
        return localStorage.getItem(PWA_INSTALL_DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}

function PwaInstallPrompt() {
    const { t } = useLocale();
    const [dismissed, setDismissed] = useState(loadDismissed);
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showIosHint, setShowIosHint] = useState(false);

    useEffect(() => {
        if (!canShowInstallPrompt() || dismissed || firebaseConnection.mode === 'emulator') {
            return undefined;
        }

        if (isIosSafari()) {
            setShowIosHint(true);
            return undefined;
        }

        const onBeforeInstall = (event) => {
            event.preventDefault();
            setDeferredPrompt(event);
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    }, [dismissed]);

    const dismiss = useCallback(() => {
        try {
            localStorage.setItem(PWA_INSTALL_DISMISS_KEY, '1');
        } catch {
            /* private mode */
        }
        setDismissed(true);
        setDeferredPrompt(null);
        setShowIosHint(false);
    }, []);

    const install = useCallback(async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
        dismiss();
    }, [deferredPrompt, dismiss]);

    if (dismissed || firebaseConnection.mode === 'emulator' || !canShowInstallPrompt()) {
        return null;
    }

    if (showIosHint) {
        return (
            <aside className="pwa-install-banner" role="note">
                <p className="pwa-install-banner__title">{t('pwa.iosTitle')}</p>
                <p className="pwa-install-banner__text">{t('pwa.iosText')}</p>
                <div className="pwa-install-banner__actions">
                    <button type="button" className="pwa-install-banner__dismiss" onClick={dismiss}>
                        {t('pwa.dismiss')}
                    </button>
                </div>
            </aside>
        );
    }

    if (!deferredPrompt) return null;

    return (
        <aside className="pwa-install-banner" role="note">
            <p className="pwa-install-banner__title">{t('pwa.title')}</p>
            <p className="pwa-install-banner__text">{t('pwa.text')}</p>
            <div className="pwa-install-banner__actions">
                <button type="button" className="btn-accent pwa-install-banner__install" onClick={() => void install()}>
                    {t('pwa.install')}
                </button>
                <button type="button" className="pwa-install-banner__dismiss" onClick={dismiss}>
                    {t('pwa.dismiss')}
                </button>
            </div>
        </aside>
    );
}

export default PwaInstallPrompt;
