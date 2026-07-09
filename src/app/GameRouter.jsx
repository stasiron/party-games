import { lazy, Suspense, memo, Component } from 'react';
import { isGameComingSoon } from '../lib/gameCatalog';
import { useRoomPlayers } from '../context/RoomPlayersContext';
import { useLocale } from '../locales/LocaleContext';

class GameChunkErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="content-panel content-panel--dark">
                    <p className="text-error">{this.props.message}</p>
                    <div className="actions-stack">
                        <button type="button" className="btn-accent" onClick={() => window.location.reload()}>
                            {this.props.reloadLabel}
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const NeverHaveIEver = lazy(() => import('../games/never-have-i-ever/NeverHaveIEver'));
const Impostor = lazy(() => import('../games/impostor/Impostor'));
const TruthOrDare = lazy(() => import('../games/truth-or-dare/TruthOrDare'));
const Mafia = lazy(() => import('../games/mafia/Mafia'));
const DarkStories = lazy(() => import('../games/dark-stories/DarkStories'));
const WhoWouldRather = lazy(() => import('../games/who-would-rather/WhoWouldRather'));
const KtoNajpredzej = lazy(() => import('../games/kto-najpredzej/KtoNajpredzej'));
const Telepathy = lazy(() => import('../games/telepathy/Telepathy'));
const JustOne = lazy(() => import('../games/just-one/JustOne'));
const SingIt = lazy(() => import('../games/sing-it/SingIt'));
const TopTen = lazy(() => import('../games/top-ten/TopTen'));
const ComingSoonGame = lazy(() => import('../components/ComingSoonGame'));

function GameRouter({
    selectedGameType,
    currentGameMeta,
    effectiveIsHost,
    isLobbyHost = false,
    handleLeaveRoom,
    handleCloseRoom,
    handleBackToMenu,
    playerName,
    myPlayerId,
    vibrationEnabled,
    isRoomLocked,
    roomId,
    hostShareOptions,
    hasAdminPowers = false,
}) {
    const tablePlayers = useRoomPlayers();
    const { t } = useLocale();
    const canManageGame = effectiveIsHost || isLobbyHost || hasAdminPowers;

    return (
        <GameChunkErrorBoundary
            message={t('common.gameLoadFailed')}
            reloadLabel={t('common.reloadPage')}
        >
            <Suspense fallback={<p className="game-loading">{t('common.loadingGame')}</p>}>
            {selectedGameType === 'never-have-i-ever' && (
                <NeverHaveIEver
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'truth-or-dare' && (
                <TruthOrDare
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    playerName={playerName}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    vibrationEnabled={vibrationEnabled}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'impostor' && (
                <Impostor
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    onCloseRoom={handleCloseRoom}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    isRoomLocked={isRoomLocked}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'mafia' && (
                <Mafia
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    isRoomLocked={isRoomLocked}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'dark-stories' && (
                <DarkStories
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'who-would-rather' && (
                <WhoWouldRather
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    playerName={playerName}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    vibrationEnabled={vibrationEnabled}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'kto-najpredzej' && (
                <KtoNajpredzej
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'telepathy' && (
                <Telepathy
                    isHost={effectiveIsHost}
                    hasAdminPowers={hasAdminPowers}
                    onLeave={handleLeaveRoom}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'just-one' && (
                <JustOne
                    isHost={effectiveIsHost}
                    hasAdminPowers={hasAdminPowers}
                    onLeave={handleLeaveRoom}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType === 'sing-it' && (
                <SingIt
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

                    {selectedGameType === 'top-ten' && (
                <TopTen
                    isHost={canManageGame}
                    hasAdminPowers={hasAdminPowers}
                    onLeave={handleLeaveRoom}
                    onCloseRoom={handleCloseRoom}
                    onBackToMenu={handleBackToMenu}
                    myPlayerId={myPlayerId}
                    tablePlayers={tablePlayers}
                    isRoomLocked={isRoomLocked}
                    roomId={roomId}
                    shareOptions={hostShareOptions}
                />
            )}

            {selectedGameType && isGameComingSoon(selectedGameType) && currentGameMeta && (
                <ComingSoonGame
                    title={currentGameMeta.name}
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                />
            )}
            </Suspense>
        </GameChunkErrorBoundary>
    );
}

export default memo(GameRouter);
