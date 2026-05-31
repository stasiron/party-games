import { useLocale } from '../../locales/LocaleContext';

function AdminConsole({ adminCommand, onCommandChange, onSubmit }) {
    const { t } = useLocale();

    return (
        <div className="admin-panel-container">
            <input
                type="text"
                value={adminCommand}
                onChange={(e) => onCommandChange(e.target.value)}
                placeholder={t('admin.placeholder')}
                onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
                className="input-admin-console"
            />
        </div>
    );
}

export default AdminConsole;
