import { useEffect } from 'react';
import { firebaseConnection } from '../lib/firebase';
import { applyLowPowerClass, isLowPowerDevice } from '../lib/lowPower';
import { useServerBusy } from '../context/useServerBusy';
import versionData from '../../version.json';

function formatPing(pingMs, pingError, isPinging) {
    if (pingError) return 'brak połączenia z bazą';
    if (isPinging && pingMs === null) return 'serwer myśli…';
    if (pingMs === null) return 'mierzenie…';
    if (pingMs < 80) return `~${pingMs} ms — szybko`;
    if (pingMs < 200) return `~${pingMs} ms — OK`;
    if (pingMs < 500) return `~${pingMs} ms — wolniej`;
    return `~${pingMs} ms — duże opóźnienie`;
}

function ConnectionStatus() {
    const isPi = firebaseConnection.mode === 'emulator';
    const lowPower = isLowPowerDevice();
    const { pingMs, pingError, isPinging, isSlow } = useServerBusy();

    useEffect(() => {
        applyLowPowerClass();
    }, [isPi]);

    const backendLabel = isPi
        ? `Raspberry Pi · lokalna baza (${firebaseConnection.emulatorHost}:${firebaseConnection.emulatorPort})`
        : 'Google Cloud · baza w internecie';

    const perfLabel = lowPower
        ? 'Tryb oszczędny: animacje i efekty wyłączone'
        : 'Tryb pełny: animacje i efekty włączone';

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
                Opóźnienie bazy: {formatPing(pingMs, pingError, isPinging)}
            </div>
            <div className="connection-status__perf">{perfLabel}</div>
            <div className="connection-status__version">Party Games v{versionData.version}</div>
        </footer>
    );
}

export default ConnectionStatus;
