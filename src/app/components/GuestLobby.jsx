import { useMemo } from 'react';
import { localizeCatalogGames } from '../../lib/gameMeta.js';
import { ROOM_CODE_LENGTH } from '../constants';
import { useLocale } from '../../locales/LocaleContext.jsx';
import { prefetchGameChunk } from '../../lib/prefetchGameChunk';

function GuestLobby({
    manualRoomCode,
    onManualRoomCodeChange,
    onJoinByCode,
    lobbyFilters,
    onLobbyFiltersChange,
    activeRooms,
    roomsListReady = false,
    onRefreshRooms,
    roomsRefreshing,
    onOpenRoom,
    hasAdminPowers,
    onAdminDeleteRoom,
    onBack,
}) {
    const { t, gameContent } = useLocale();
    const playableGames = useMemo(
        () => localizeCatalogGames(gameContent.games, t).filter((g) => !g.comingSoon),
        [gameContent.games, t]
    );

    return (
        <>
            <p>{t('lobby.guest.hint')}</p>
            <input
                type="text"
                value={manualRoomCode}
                onChange={(e) => onManualRoomCodeChange(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                )}
                placeholder={t('lobby.guest.roomCodePlaceholder')}
                maxLength={ROOM_CODE_LENGTH}
            />
            <div className="actions-stack join-code-actions">
                <button
                    type="button"
                    onClick={() => onJoinByCode(manualRoomCode.trim())}
                    disabled={manualRoomCode.trim() === ''}
                >
                    {t('lobby.guest.joinByCode')}
                </button>
            </div>
            <div className="guest-lobby-filters-wrap">
                <button
                    type="button"
                    className="btn-collapsible-toggle guest-lobby-filters-trigger"
                    aria-expanded={lobbyFilters.panelOpen}
                    onClick={() => onLobbyFiltersChange((prev) => ({
                        ...prev,
                        panelOpen: !prev.panelOpen,
                    }))}
                >
                    {lobbyFilters.panelOpen ? t('lobby.guest.hideFilters') : t('lobby.guest.showFilters')}
                    {!lobbyFilters.enabled && (
                        <span className="guest-lobby-filters-trigger__badge">{t('lobby.guest.filtersDisabled')}</span>
                    )}
                </button>
                {lobbyFilters.panelOpen && (
                    <div
                        className={`guest-lobby-filters ${lobbyFilters.enabled ? '' : 'guest-lobby-filters--disabled'}`}
                        role="group"
                        aria-label={t('lobby.guest.filtersAria')}
                    >
                        <button
                            type="button"
                            className="settings-toggle guest-lobby-filters__toggle guest-lobby-filters__toggle--master"
                            aria-pressed={lobbyFilters.enabled}
                            onClick={() => onLobbyFiltersChange((prev) => ({
                                ...prev,
                                enabled: !prev.enabled,
                            }))}
                        >
                            <span>{t('lobby.guest.filtersEnabled')}</span>
                            <span className={`settings-toggle__icon ${lobbyFilters.enabled ? 'on' : 'off'}`}>
                                {lobbyFilters.enabled ? '✓' : '–'}
                            </span>
                        </button>
                        <fieldset
                            className="guest-lobby-filters__fields"
                            disabled={!lobbyFilters.enabled}
                        >
                            <div className="guest-lobby-filters__section">
                                <span className="guest-lobby-filters__label" id="guest-filter-game-label">
                                    {t('lobby.guest.filterGame')}
                                </span>
                                <div
                                    className="games-grid guest-lobby-filters__game-grid"
                                    role="group"
                                    aria-labelledby="guest-filter-game-label"
                                >
                                    <button
                                        type="button"
                                        className={`game-btn guest-lobby-filters__game-btn guest-lobby-filters__game-btn--all ${lobbyFilters.gameId === '' ? 'guest-lobby-filters__game-btn--active' : ''}`}
                                        aria-pressed={lobbyFilters.gameId === ''}
                                        onClick={() => onLobbyFiltersChange((prev) => ({
                                            ...prev,
                                            gameId: '',
                                        }))}
                                    >
                                        <span className="game-title">{t('lobby.guest.filterAllGames')}</span>
                                        <span className="game-desc">{t('lobby.guest.filterAllGamesDesc')}</span>
                                    </button>
                                    {playableGames.map((game) => (
                                        <button
                                            key={game.id}
                                            type="button"
                                            className={`game-btn guest-lobby-filters__game-btn ${lobbyFilters.gameId === game.id ? 'guest-lobby-filters__game-btn--active' : ''}`}
                                            aria-pressed={lobbyFilters.gameId === game.id}
                                            onPointerEnter={() => prefetchGameChunk(game.id)}
                                            onFocus={() => prefetchGameChunk(game.id)}
                                            onClick={() => onLobbyFiltersChange((prev) => ({
                                                ...prev,
                                                gameId: game.id,
                                            }))}
                                        >
                                            <span className="game-title">{game.name}</span>
                                            <span className="game-desc">{game.description}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="guest-lobby-filters__section">
                                <span className="guest-lobby-filters__label" id="guest-filter-min-label">
                                    {t('lobby.guest.filterMinOnline')}
                                </span>
                                <div
                                    className="guest-lobby-filters__chips"
                                    role="group"
                                    aria-labelledby="guest-filter-min-label"
                                >
                                    {[0, 1, 2].map((min) => (
                                        <button
                                            key={min}
                                            type="button"
                                            className={`guest-link-chip ${lobbyFilters.minOnline === min ? 'guest-link-chip--active' : ''}`}
                                            aria-pressed={lobbyFilters.minOnline === min}
                                            onClick={() => onLobbyFiltersChange((prev) => ({
                                                ...prev,
                                                minOnline: min,
                                            }))}
                                        >
                                            {min}+
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="settings-toggle guest-lobby-filters__toggle"
                                aria-pressed={lobbyFilters.hideClosed}
                                onClick={() => onLobbyFiltersChange((prev) => ({
                                    ...prev,
                                    hideClosed: !prev.hideClosed,
                                }))}
                            >
                                <span>{t('lobby.guest.filterHideClosed')}</span>
                                <span className={`settings-toggle__icon ${lobbyFilters.hideClosed ? 'on' : 'off'}`}>
                                    {lobbyFilters.hideClosed ? '✓' : '–'}
                                </span>
                            </button>
                        </fieldset>
                    </div>
                )}
            </div>
            <div className="guest-rooms-toolbar">
                <button
                    type="button"
                    className="btn-link guest-rooms-refresh-btn"
                    onClick={onRefreshRooms}
                    disabled={roomsRefreshing}
                    aria-busy={roomsRefreshing}
                >
                    {roomsRefreshing ? t('lobby.guest.refreshing') : t('lobby.guest.refresh')}
                </button>
            </div>
            <div className="games-grid guest-rooms-grid">
                {activeRooms.map((room) => (
                    <div
                        key={room.roomId}
                        className={`guest-room-card ${room.matchesFilters === false ? 'guest-room-card--dimmed' : ''}`}
                    >
                        <button
                            type="button"
                            className="guest-room-btn"
                            onPointerEnter={() => prefetchGameChunk(room.gameId)}
                            onFocus={() => prefetchGameChunk(room.gameId)}
                            onClick={() => {
                                prefetchGameChunk(room.gameId);
                                onOpenRoom(room.roomId, { fromList: true });
                            }}
                        >
                            <span className="game-title">
                                {room.gameName}
                                {room.joinModeBadge}{room.admissionBadge}
                                {room.pendingCount > 0
                                    ? ` · ${t('lobby.guest.roomWaiting', { count: room.pendingCount })}`
                                    : ''}
                            </span>
                            <span className="guest-room-host">
                                {room.hostName
                                    ? t('lobby.guest.roomOfHost', { name: room.hostName })
                                    : t('lobby.guest.roomNoHost')}
                            </span>
                            <span className="guest-room-meta">
                                {t('lobby.guest.playersOnline', { count: room.onlineCount })}
                            </span>
                            {room.showCode ? (
                                <span className="guest-room-code">{room.roomId}</span>
                            ) : (
                                <span className="guest-room-invite-hint">
                                    {t('lobby.guest.inviteOnlyHint')}
                                </span>
                            )}
                        </button>
                        {hasAdminPowers && (
                            <button
                                type="button"
                                className="btn-admin-kick"
                                onClick={() => onAdminDeleteRoom(room.roomId)}
                                title={t('lobby.guest.adminDeleteTitle', { roomId: room.roomId })}
                            >
                                {t('lobby.guest.adminDeleteRoom')}
                            </button>
                        )}
                    </div>
                ))}
            </div>
            {!roomsListReady && (
                <p className="join-progress" aria-live="polite">
                    {t('lobby.guest.loadingRooms')}
                </p>
            )}
            {roomsListReady && activeRooms.length === 0 && (
                <p className="join-progress">{t('lobby.guest.noRooms')}</p>
            )}
            <button type="button" onClick={onBack} className="btn-link">{t('common.back')}</button>
        </>
    );
}

export default GuestLobby;
