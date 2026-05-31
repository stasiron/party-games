import { useMemo } from 'react';
import { getComingSoonMessage } from '../../lib/gameCatalog.js';
import { localizeCatalogGames } from '../../lib/gameMeta.js';
import { getJoinModeOptions } from '../../lib/roomAccessLabels.js';
import {
    MIN_ROOM_PASSWORD_LENGTH,
    MAX_ROOM_PASSWORD_LENGTH,
} from '../../lib/roomPassword';
import { useLocale } from '../../locales/LocaleContext.jsx';
import { prefetchGameChunk } from '../../lib/prefetchGameChunk';

function HostLobby({
    hostJoinMode,
    hostRoomPassword,
    onJoinModeChange,
    onPasswordChange,
    onCreateRoom,
    onBack,
    onComingSoon,
}) {
    const { t, gameContent } = useLocale();
    const joinModeOptions = useMemo(() => getJoinModeOptions(t), [t]);
    const localizedGames = useMemo(
        () => localizeCatalogGames(gameContent.games, t),
        [gameContent.games, t]
    );

    return (
        <>
            <p>{t('lobby.host.hint')}</p>
            <div className="host-room-options">
                <p className="host-room-options__label">{t('lobby.host.accessLabel')}</p>
                <div className="host-join-mode-grid">
                    {joinModeOptions.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            className={`host-join-mode-option ${hostJoinMode === opt.id ? 'active' : ''}`}
                            onClick={() => onJoinModeChange(opt.id)}
                            aria-pressed={hostJoinMode === opt.id}
                        >
                            <span className="host-join-mode-option__title">
                                {opt.icon} {opt.label}
                            </span>
                            <span className="host-join-mode-option__desc">{opt.desc}</span>
                        </button>
                    ))}
                </div>
                {hostJoinMode === 'password' && (
                    <div className="host-room-private-fields">
                        <label className="host-room-private-fields__label" htmlFor="host-room-password">
                            {t('lobby.host.passwordLabel')}
                        </label>
                        <input
                            id="host-room-password"
                            type="password"
                            value={hostRoomPassword}
                            onChange={(e) => onPasswordChange(e.target.value)}
                            placeholder={t('lobby.host.passwordPlaceholder', {
                                min: MIN_ROOM_PASSWORD_LENGTH,
                                max: MAX_ROOM_PASSWORD_LENGTH,
                            })}
                            maxLength={MAX_ROOM_PASSWORD_LENGTH}
                            autoComplete="new-password"
                            className="host-room-private-fields__input"
                        />
                    </div>
                )}
            </div>
            <div className="games-grid">
                {localizedGames.map((game) => {
                    const soon = game.comingSoon === true;
                    return (
                        <button
                            key={game.id}
                            type="button"
                            className={soon ? 'game-btn game-btn--soon' : 'game-btn'}
                            disabled={soon}
                            aria-disabled={soon}
                            onPointerEnter={() => prefetchGameChunk(game.id)}
                            onFocus={() => prefetchGameChunk(game.id)}
                            onClick={() => {
                                if (soon) {
                                    onComingSoon(getComingSoonMessage(game, t));
                                    return;
                                }
                                prefetchGameChunk(game.id);
                                onCreateRoom(game.id, {
                                    joinMode: hostJoinMode,
                                    password: hostRoomPassword,
                                });
                            }}
                        >
                            <span className="game-title">
                                {game.name}
                                {soon && (
                                    <span className="game-badge-soon">{t('common.soon')}</span>
                                )}
                            </span>
                            <span className="game-desc">
                                {soon
                                    ? t('lobby.host.comingSoonDesc')
                                    : game.description}
                            </span>
                        </button>
                    );
                })}
            </div>
            <button type="button" onClick={onBack} className="btn-link">{t('common.back')}</button>
        </>
    );
}

export default HostLobby;
