import { useLocale } from '../../locales/LocaleContext';

function EntryRolePicker({ onSelectHost, onSelectGuest }) {
    const { t } = useLocale();

    return (
        <>
            <p>{t('entryRole.prompt')}</p>
            <div className="actions-stack">
                <button
                    type="button"
                    onClick={onSelectHost}
                    className="entry-role-btn entry-role-btn--host"
                >
                    {t('entryRole.host')}
                </button>
                <button
                    type="button"
                    onClick={onSelectGuest}
                    className="entry-role-btn entry-role-btn--guest"
                >
                    {t('entryRole.guest')}
                </button>
            </div>
        </>
    );
}

export default EntryRolePicker;
