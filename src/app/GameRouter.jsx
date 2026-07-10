import { lazy, Suspense, memo, Component, useMemo } from 'react';
import { isGameComingSoon } from '../lib/gameCatalog';
import { useRoomPlayers } from '../context/RoomPlayersContext';
import { useRoom } from '../context/RoomContext';
import { useLocale } from '../locales/LocaleContext';
import { buildGameRoomProps } from '../lib/room/gameRoomContract';

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
    currentGameMeta,
    playerName,
    vibrationEnabled,
}) {
    const {
        selectedGameType,
        selectedGame: roomId,
        effectiveIsHost,
        handleLeaveRoom,
        myPlayerId,
        isRoomLocked,
        hostShareOptions,
        hasAdminPowers,
    } = useRoom();
    const tablePlayers = useRoomPlayers();
    const { t } = useLocale();

    const roomProps = useMemo(() => buildGameRoomProps({
        roomId,
        gameId: selectedGameType,
        effectiveIsHost,
        hasAdminPowers,
        handleLeaveRoom,
        myPlayerId,
        tablePlayers,
        playerName,
        hostShareOptions,
        isRoomLocked,
        vibrationEnabled,
    }), [
        roomId,
        selectedGameType,
        effectiveIsHost,
        hasAdminPowers,
        handleLeaveRoom,
        myPlayerId,
        tablePlayers,
        playerName,
        hostShareOptions,
        isRoomLocked,
        vibrationEnabled,
    ]);

    return (
        <GameChunkErrorBoundary
            message={t('common.gameLoadFailed')}
            reloadLabel={t('common.reloadPage')}
        >
            <Suspense fallback={<p className="game-loading">{t('common.loadingGame')}</p>}>
            {selectedGameType === 'never-have-i-ever' && (
                <NeverHaveIEver {...roomProps} />
            )}

            {selectedGameType === 'truth-or-dare' && (
                <TruthOrDare {...roomProps} />
            )}

            {selectedGameType === 'impostor' && (
                <Impostor {...roomProps} />
            )}

            {selectedGameType === 'mafia' && (
                <Mafia {...roomProps} />
            )}

            {selectedGameType === 'dark-stories' && (
                <DarkStories {...roomProps} />
            )}

            {selectedGameType === 'who-would-rather' && (
                <WhoWouldRather {...roomProps} />
            )}

            {selectedGameType === 'kto-najpredzej' && (
                <KtoNajpredzej {...roomProps} />
            )}

            {selectedGameType === 'telepathy' && (
                <Telepathy {...roomProps} />
            )}

            {selectedGameType === 'just-one' && (
                <JustOne {...roomProps} />
            )}

            {selectedGameType === 'sing-it' && (
                <SingIt {...roomProps} />
            )}

            {selectedGameType === 'top-ten' && (
                <TopTen {...roomProps} />
            )}

            {selectedGameType && isGameComingSoon(selectedGameType) && currentGameMeta && (
                <ComingSoonGame
                    title={currentGameMeta.name}
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                    gameId={selectedGameType}
                />
            )}
            </Suspense>
        </GameChunkErrorBoundary>
    );
}

export default memo(GameRouter);
