import { memo, useCallback, useState } from 'react';
import { BUG_REPORT_CATEGORIES, submitBugReport } from '../lib/bugReport';

const BugReportPanel = memo(({ context, onClose }) => {
    const [category, setCategory] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');

    const handleSubmit = useCallback(async () => {
        if (busy) return;
        if (!category) {
            setStatus('Wybierz kategorię błędu.');
            return;
        }

        setBusy(true);
        setStatus('');
        try {
            await submitBugReport({ category, message, context });
            setCategory('');
            setMessage('');
            setStatus('Dzięki! Zgłoszenie wysłane.');
        } catch (error) {
            if (error?.message === 'RATE_LIMIT') {
                setStatus('Możesz wysłać kolejne zgłoszenie za 5 minut (limit na IP).');
            } else {
                setStatus('Nie udało się wysłać. Spróbuj ponownie za chwilę.');
            }
        } finally {
            setBusy(false);
        }
    }, [busy, category, message, context]);

    return (
        <div className="settings-panel bug-report-panel" role="dialog" aria-label="Zgłoś błąd">
            <div className="settings-panel__header">
                <h2>Zgłoś błąd</h2>
                <button
                    type="button"
                    className="settings-close"
                    onClick={onClose}
                    aria-label="Zamknij zgłoszenie błędu"
                >
                    ✕
                </button>
            </div>

            <fieldset className="bug-report-categories">
                <legend className="settings-panel__label">Kategoria</legend>
                <div className="bug-report-categories__grid">
                    {BUG_REPORT_CATEGORIES.map((item) => (
                        <label
                            key={item.id}
                            className={`bug-report-category ${category === item.id ? 'active' : ''}`}
                        >
                            <input
                                type="radio"
                                name="bug-report-category"
                                value={item.id}
                                checked={category === item.id}
                                onChange={() => setCategory(item.id)}
                            />
                            <span>{item.label}</span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="settings-panel__group">
                <label className="settings-panel__label" htmlFor="bug-report-message">
                    Co poszło nie tak? <span className="bug-report-optional">(opcjonalnie)</span>
                </label>
                <textarea
                    id="bug-report-message"
                    className="bug-report-message account-input"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    rows={4}
                    placeholder="Opisz problem — im więcej szczegółów, tym łatwiej go naprawić."
                />
            </div>

            <button
                type="button"
                className="settings-toggle bug-report-submit"
                onClick={handleSubmit}
                disabled={busy}
            >
                <span>{busy ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}</span>
                <span className="settings-toggle__icon on">→</span>
            </button>

            {status && <p className="settings-hint settings-hint--tight">{status}</p>}
            <p className="settings-hint settings-hint--tight">
                Do zgłoszenia dołączamy panel, liczbę graczy, wersję i kontekst gry (bez haseł). Limit: 1× / 5 min na IP.
            </p>
        </div>
    );
});

BugReportPanel.displayName = 'BugReportPanel';

export default BugReportPanel;
