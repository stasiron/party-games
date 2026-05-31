import { useLocale } from '../../locales/LocaleContext';

function AccountCenterPanel({
    authUser,
    authBusy,
    authStatus,
    accountNickname,
    accountEmail,
    nicknameSavedAt,
    lastKnownRoomId,
    isJoined,
    hasGoogleProvider,
    hasEmailProvider,
    onClose,
    onNicknameChange,
    onEmailChange,
    onSaveNickname,
    onGoogleAuth,
    onSendMagicLink,
    onCompleteMagicLink,
    onConnectGoogle,
    onSignOut,
    onJoinLastKnownGame,
}) {
    const { t } = useLocale();

    return (
        <div className="account-panel" role="dialog" aria-label={t('account.title')}>
            <div className="settings-panel__header">
                <h2>{t('account.title')}</h2>
                <button
                    type="button"
                    className="settings-close"
                    onClick={onClose}
                    aria-label={t('account.closeAria')}
                >
                    ✕
                </button>
            </div>

            <p className="account-status-line">
                {authUser?.email
                    ? t('account.loggedIn', { email: authUser.email })
                    : t('account.notLoggedIn')}
            </p>

            {!hasEmailProvider && (
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onGoogleAuth}
                    disabled={authBusy}
                >
                    <span>{t('account.googleAuth')}</span>
                    <span className="settings-toggle__icon on">G</span>
                </button>
            )}

            <div className="settings-panel__group">
                <label className="settings-panel__label" htmlFor="account-nickname-input">
                    {t('account.nicknameLabel')}
                </label>
                <input
                    id="account-nickname-input"
                    type="text"
                    value={accountNickname}
                    onChange={(event) => onNicknameChange(event.target.value)}
                    maxLength={24}
                    placeholder={t('account.nicknamePlaceholder')}
                    className="account-input"
                />
                <button
                    type="button"
                    className="btn-link"
                    onClick={onSaveNickname}
                    disabled={authBusy}
                >
                    {t('account.saveNickname')}
                </button>
                {nicknameSavedAt > 0 && <p className="account-success">{t('account.nicknameSaved')}</p>}
            </div>

            {!hasGoogleProvider && (
                <div className="settings-panel__group">
                    <label className="settings-panel__label" htmlFor="account-email-input">
                        {t('account.emailLabel')}
                    </label>
                    <input
                        id="account-email-input"
                        type="email"
                        value={accountEmail}
                        onChange={(event) => onEmailChange(event.target.value)}
                        placeholder="twoj@email.com"
                        className="account-input"
                    />
                    <div className="account-actions-row">
                        <button type="button" className="btn-link" onClick={onSendMagicLink} disabled={authBusy}>
                            {t('account.sendLink')}
                        </button>
                        <button type="button" className="btn-link" onClick={onCompleteMagicLink} disabled={authBusy}>
                            {t('account.completeLink')}
                        </button>
                    </div>
                </div>
            )}

            {!!lastKnownRoomId && !isJoined && (
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onJoinLastKnownGame}
                    disabled={authBusy}
                >
                    <span>{t('account.joinLastRoom', { roomId: lastKnownRoomId })}</span>
                    <span className="settings-toggle__icon on">▶</span>
                </button>
            )}

            <button
                type="button"
                className="settings-toggle"
                onClick={onConnectGoogle}
                disabled={authBusy}
            >
                <span>{t('account.connectGoogle')}</span>
                <span className="settings-toggle__icon on">+</span>
            </button>

            {authUser && (
                <button
                    type="button"
                    className="settings-toggle"
                    onClick={onSignOut}
                    disabled={authBusy}
                >
                    <span>{t('account.signOut')}</span>
                    <span className="settings-toggle__icon off">↩</span>
                </button>
            )}

            {authStatus && <p className="settings-hint settings-hint--tight">{authStatus}</p>}
        </div>
    );
}

export default AccountCenterPanel;
