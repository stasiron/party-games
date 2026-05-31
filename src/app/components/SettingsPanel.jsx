import { isLowPowerDevice } from '../../lib/lowPower';
import { themePresets } from '../../lib/themePresets';
import { useLocale } from '../../locales/LocaleContext';

function SettingsPanel({
    themePreset,
    soundEnabled,
    vibrationEnabled,
    showConnectionFooter,
    continuousPingEnabled,
    powerSaveMode,
    showAdminPanel,
    onClose,
    onThemeChange,
    onSoundToggle,
    onVibrationToggle,
    onConnectionFooterToggle,
    onContinuousPingToggle,
    onPowerSaveToggle,
    onOpenAdminPanel,
}) {
    const { t } = useLocale();

    return (
        <div className="settings-panel" role="dialog" aria-label={t('settings.title')}>
            <div className="settings-panel__header">
                <h2>{t('settings.title')}</h2>
                <button
                    type="button"
                    className="settings-close"
                    onClick={onClose}
                    aria-label={t('settings.closeAria')}
                >
                    ✕
                </button>
            </div>

            <div className="settings-panel__group">
                <div className="settings-panel__label">{t('settings.themeLabel')}</div>
                <div className="settings-presets">
                    {themePresets.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={`settings-preset ${themePreset === preset.id ? 'active' : ''}`}
                            onClick={() => onThemeChange(preset.id)}
                            aria-label={t(`themes.${preset.id}`)}
                            aria-pressed={themePreset === preset.id}
                            style={{
                                background: `linear-gradient(135deg, ${preset.stops[0]} 0%, ${preset.stops[1]} 50%, ${preset.stops[2]} 100%)`
                            }}
                        >
                            <span className="sr-only">{t(`themes.${preset.id}`)}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onSoundToggle}
                    aria-pressed={soundEnabled}
                >
                    <span>{t('settings.sound')}</span>
                    <span className={`settings-toggle__icon ${soundEnabled ? 'on' : 'off'}`}>
                        {soundEnabled ? '✔' : '✕'}
                    </span>
                </button>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onVibrationToggle}
                    aria-pressed={vibrationEnabled}
                >
                    <span>{t('settings.vibration')}</span>
                    <span className={`settings-toggle__icon ${vibrationEnabled ? 'on' : 'off'}`}>
                        {vibrationEnabled ? '✔' : '✕'}
                    </span>
                </button>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onConnectionFooterToggle}
                    aria-pressed={showConnectionFooter}
                >
                    <span>{t('settings.connectionFooter')}</span>
                    <span className={`settings-toggle__icon ${showConnectionFooter ? 'on' : 'off'}`}>
                        {showConnectionFooter ? '✔' : '✕'}
                    </span>
                </button>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onContinuousPingToggle}
                    aria-pressed={continuousPingEnabled}
                >
                    <span>{t('settings.continuousPing')}</span>
                    <span className={`settings-toggle__icon ${continuousPingEnabled ? 'on' : 'off'}`}>
                        {continuousPingEnabled ? '✔' : '✕'}
                    </span>
                </button>
                <p className="settings-hint settings-hint--tight">
                    {t('settings.continuousPingHint')}
                </p>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onPowerSaveToggle}
                    aria-pressed={powerSaveMode}
                >
                    <span>{t('settings.powerSave')}</span>
                    <span className={`settings-toggle__icon ${powerSaveMode ? 'on' : 'off'}`}>
                        {powerSaveMode ? '✔' : '✕'}
                    </span>
                </button>
                <p className="settings-hint settings-hint--tight">
                    {t('settings.powerSaveHint')}
                </p>
            </div>

            <div className="settings-panel__group">
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onOpenAdminPanel}
                    aria-pressed={showAdminPanel}
                >
                    <span>{t('settings.adminConsole')}</span>
                    <span className={`settings-toggle__icon ${showAdminPanel ? 'on' : 'off'}`}>
                        {showAdminPanel ? '✔' : '✕'}
                    </span>
                </button>
                <p className="settings-hint settings-hint--tight">
                    {t('settings.adminConsoleHint')}
                </p>
            </div>

            <p className="settings-hint">
                {isLowPowerDevice()
                    ? t('settings.hintLowPower')
                    : t('settings.hintFull')}
            </p>
        </div>
    );
}

export default SettingsPanel;
