import { memo, useCallback, useState } from 'react';
import {
    BUG_REPORT_CATEGORIES,
    copyBugReportToClipboard,
    formatBugReportClipboardText,
    submitBugReport,
} from '../lib/bugReport';
import { useLocale } from '../locales/LocaleContext';

const BugReportPanel = memo(({ context, getDiagnostics, onClose }) => {
    const { t, locale } = useLocale();
    const [category, setCategory] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [copyBusy, setCopyBusy] = useState(false);
    const [status, setStatus] = useState('');

    const handleSubmit = useCallback(async () => {
        if (busy) return;
        if (!category) {
            setStatus(t('bugReport.pickCategory'));
            return;
        }

        setBusy(true);
        setStatus('');
        try {
            await submitBugReport({ category, message, context });
            setCategory('');
            setMessage('');
            setStatus(t('bugReport.thanks'));
        } catch (error) {
            if (error?.message === 'RATE_LIMIT') {
                setStatus(t('bugReport.rateLimit'));
            } else if (error?.message === 'PERMISSION_DENIED') {
                setStatus(t('bugReport.permissionDenied'));
            } else {
                if (import.meta.env.DEV) {
                    console.error('[BugReport] submit failed', error);
                }
                setStatus(t('bugReport.failed'));
            }
        } finally {
            setBusy(false);
        }
    }, [busy, category, message, context, t]);

    const handleCopy = useCallback(async () => {
        if (copyBusy) return;
        setCopyBusy(true);
        setStatus('');
        try {
            const categoryLabel = category
                ? t(`bugReport.categories.${category}`)
                : '';
            const text = formatBugReportClipboardText({
                category: category || null,
                categoryLabel,
                message,
                context,
                locale,
                diagnostics: typeof getDiagnostics === 'function' ? getDiagnostics() : null,
            });
            await copyBugReportToClipboard(text);
            setStatus(t('bugReport.copied'));
        } catch {
            setStatus(t('bugReport.copyFailed'));
        } finally {
            setCopyBusy(false);
        }
    }, [copyBusy, category, message, context, locale, getDiagnostics, t]);

    return (
        <div className="settings-panel bug-report-panel" role="dialog" aria-label={t('bugReport.title')}>
            <div className="settings-panel__header">
                <h2>{t('bugReport.title')}</h2>
                <button
                    type="button"
                    className="settings-close"
                    onClick={onClose}
                    aria-label={t('bugReport.closeAria')}
                >
                    ✕
                </button>
            </div>

            <fieldset className="bug-report-categories">
                <legend className="settings-panel__label">{t('bugReport.category')}</legend>
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
                            <span>{t(`bugReport.categories.${item.id}`)}</span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="settings-panel__group">
                <label className="settings-panel__label" htmlFor="bug-report-message">
                    {t('bugReport.messageLabel')}{' '}
                    <span className="bug-report-optional">{t('bugReport.optional')}</span>
                </label>
                <textarea
                    id="bug-report-message"
                    className="bug-report-message account-input"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    rows={4}
                    placeholder={t('bugReport.messagePlaceholder')}
                />
            </div>

            <div className="bug-report-actions">
                <button
                    type="button"
                    className="settings-toggle bug-report-submit"
                    onClick={handleSubmit}
                    disabled={busy || copyBusy}
                >
                    <span>{busy ? t('bugReport.submitting') : t('bugReport.submit')}</span>
                    <span className="settings-toggle__icon on">→</span>
                </button>
                <button
                    type="button"
                    className="settings-toggle bug-report-copy"
                    onClick={handleCopy}
                    disabled={busy || copyBusy}
                >
                    <span>{copyBusy ? t('bugReport.copying') : t('bugReport.copy')}</span>
                    <span className="settings-toggle__icon on" aria-hidden>
                        ⧉
                    </span>
                </button>
            </div>

            {status && <p className="settings-hint settings-hint--tight">{status}</p>}
            <p className="settings-hint settings-hint--tight">
                {t('bugReport.footerHint')}
            </p>
        </div>
    );
});

BugReportPanel.displayName = 'BugReportPanel';

export default BugReportPanel;
