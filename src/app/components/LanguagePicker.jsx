import { useLocale } from '../../locales/LocaleContext';

function LanguagePicker({ open, onToggle, onClose }) {
    const { locale, setLocale, t, supportedLocales } = useLocale();
    const current = supportedLocales.find((item) => item.id === locale) ?? supportedLocales[0];

    return (
        <>
            <button
                type="button"
                className="language-trigger"
                onClick={onToggle}
                aria-label={t('language.openAria')}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-hidden={open || undefined}
                tabIndex={open ? -1 : undefined}
            >
                {current.flag}
            </button>

            {open && (
                <div className="settings-panel language-panel" role="dialog" aria-label={t('language.panelTitle')}>
                    <div className="settings-panel__header">
                        <h2>{t('language.panelTitle')}</h2>
                        <button
                            type="button"
                            className="settings-close"
                            onClick={onClose}
                            aria-label={t('common.close')}
                        >
                            ✕
                        </button>
                    </div>
                    <p className="settings-hint settings-hint--tight">{t('language.hint')}</p>
                    <ul className="language-picker__list">
                        {supportedLocales.map((item) => (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    className={`language-picker__option ${locale === item.id ? 'active' : ''}`}
                                    onClick={() => {
                                        setLocale(item.id);
                                        onClose();
                                    }}
                                    aria-pressed={locale === item.id}
                                >
                                    <span className="language-picker__flag" aria-hidden="true">{item.flag}</span>
                                    <span>{item.label}</span>
                                    {locale === item.id && (
                                        <span className="language-picker__check" aria-hidden="true">✓</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
}

export default LanguagePicker;
