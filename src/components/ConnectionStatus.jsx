import { useEffect, memo } from 'react';
import { firebaseConnection } from '../lib/firebase';
import { applyLowPowerClass, isLowPowerDevice, shouldConserveNetwork } from '../lib/lowPower';
import { useServerBusy } from '../context/useServerBusy';
import { useLocale } from '../locales/LocaleContext';
import versionData from '../../version.json';

function formatPing(pingMs, pingError, isPinging, t) {
    if (pingError) return t('connection.noDb');
    if (isPinging && pingMs === null) return t('connection.thinking');
    if (pingMs === null) return t('connection.notMeasured');
    if (pingMs < 80) return t('connection.fast', { ms: pingMs });
    if (pingMs < 200) return t('connection.ok', { ms: pingMs });
    if (pingMs < 500) return t('connection.slow', { ms: pingMs });
    return t('connection.verySlow', { ms: pingMs });
}

function ConnectionStatus() {
    const { t } = useLocale();
    const isPi = firebaseConnection.mode === 'emulator';
    const conserve = shouldConserveNetwork();
    const {
        pingMs,
        pingError,
        isPinging,
        isSlow,
        measureOnce,
        continuousPingActive,
    } = useServerBusy();

    useEffect(() => {
        applyLowPowerClass();
    }, [isPi, conserve]);

    const backendLabel = isPi
        ? t('connection.backendPi', {
            host: firebaseConnection.emulatorHost,
            port: firebaseConnection.emulatorPort,
        })
        : t('connection.backendCloud');

    const perfLabel = conserve
        ? t('connection.perfSave')
        : isLowPowerDevice()
            ? t('connection.perfPi')
            : t('connection.perfFull');

    return (
        <footer className="connection-status" aria-live="polite">
            <div
                className={`connection-status__backend connection-status__backend--${firebaseConnection.mode}`}
                title={firebaseConnection.label}
            >
                <span className="connection-status__dot" aria-hidden="true">
                    {isPi ? '●' : '○'}
                </span>
                <span>{backendLabel}</span>
            </div>
            <div className={`connection-status__ping ${isSlow ? 'connection-status__ping--slow' : ''}`}>
                {t('connection.latencyLabel')} {formatPing(pingMs, pingError, isPinging, t)}
            </div>
            <div className="connection-status__actions">
                <button
                    type="button"
                    className="btn-link connection-status__measure-btn"
                    onClick={() => void measureOnce()}
                    disabled={isPinging}
                >
                    {isPinging ? t('connection.checking') : t('connection.measure')}
                </button>
                {continuousPingActive && (
                    <span className="connection-status__auto-hint">{t('connection.autoHint')}</span>
                )}
            </div>
            <div className="connection-status__perf">{perfLabel}</div>
            <div className="connection-status__version">
                {t('connection.versionLine', { version: versionData.version })}
            </div>
        </footer>
    );
}

export default memo(ConnectionStatus);
