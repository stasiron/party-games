import { useEffect, useState } from 'react';
import { useLocale } from '../locales/LocaleContext';

function loadLastRoomCode() {
    try {
        return localStorage.getItem('partyGames.lastRoomId.v1') || '';
    } catch {
        return '';
    }
}

function OfflineBanner() {
    const { t } = useLocale();
    const [online, setOnline] = useState(() => (
        typeof navigator === 'undefined' ? true : navigator.onLine
    ));
    const [swReady, setSwReady] = useState(false);
    const lastRoom = loadLastRoomCode();

    useEffect(() => {
        const goOnline = () => setOnline(true);
        const goOffline = () => setOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return undefined;
        navigator.serviceWorker.ready
            .then(() => setSwReady(true))
            .catch(() => {});
        return undefined;
    }, []);

    if (online) return null;

    return (
        <div className="offline-banner" role="alert">
            <strong>{t('offline.title')}</strong>{' '}
            {t('offline.body')}
            {swReady && t('offline.swActive')}
            {lastRoom ? (
                <>
                    {t('offline.lastRoom')} <strong>{lastRoom}</strong>
                </>
            ) : null}
        </div>
    );
}

export default OfflineBanner;
