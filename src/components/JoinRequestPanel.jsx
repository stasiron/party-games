import { memo, useEffect, useRef } from 'react';

function formatWaitTime(requestedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(requestedAt || 0)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)} min`;
}

const JoinRequestPanel = memo(({
    requests = [],
    onApprove,
    onReject,
    onApproveAll,
    playAlertSound,
}) => {
    const prevCountRef = useRef(requests.length);
    const panelRef = useRef(null);

    useEffect(() => {
        if (requests.length > prevCountRef.current && typeof playAlertSound === 'function') {
            playAlertSound();
        }
        prevCountRef.current = requests.length;
        if (requests.length > 0 && panelRef.current) {
            panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [requests.length, playAlertSound]);

    if (requests.length === 0) return null;

    return (
        <section ref={panelRef} className="join-request-panel" aria-live="polite">
            <div className="join-request-panel__header">
                <div>
                    <h3 className="join-request-panel__title">
                        Oczekują na wejście
                        <span className="join-request-panel__badge">{requests.length}</span>
                    </h3>
                    <p className="join-request-panel__lead">
                        Nowi gracze czekają na Twoją decyzję. Wpuść lub odrzuć każdą prośbę.
                    </p>
                </div>
                {requests.length > 1 && (
                    <button
                        type="button"
                        className="join-request-panel__approve-all"
                        onClick={onApproveAll}
                    >
                        Wpuść wszystkich
                    </button>
                )}
            </div>
            <ul className="join-request-panel__list">
                {requests.map((req) => (
                    <li key={req.id} className="join-request-panel__item">
                        <div className="join-request-panel__meta">
                            <strong>{req.name || 'Gracz'}</strong>
                            <span>Czeka {formatWaitTime(req.requestedAt)}</span>
                        </div>
                        <div className="join-request-panel__actions">
                            <button
                                type="button"
                                className="join-request-panel__btn join-request-panel__btn--approve"
                                onClick={() => onApprove(req.id)}
                            >
                                Wpuść
                            </button>
                            <button
                                type="button"
                                className="join-request-panel__btn join-request-panel__btn--reject"
                                onClick={() => onReject(req.id)}
                            >
                                Odrzuć
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
});

JoinRequestPanel.displayName = 'JoinRequestPanel';

export default JoinRequestPanel;
