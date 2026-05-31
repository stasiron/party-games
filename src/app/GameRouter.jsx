import { lazy, Suspense, memo } from 'react';
import { isGameComingSoon } from '../lib/gameCatalog';
import { useRoomPlayers } from '../context/RoomPlayersContext';
import { useLocale } from '../locales/LocaleContext';

const NeverHaveIEver = lazy(() => import('../games/never-have-i-ever/NeverHaveIEver'));
const Impostor = lazy(() => import('../games/impostor/Impostor'));
const TruthOrDare = lazy(() => import('../games/truth-or-dare/TruthOrDare'));
const Mafia = lazy(() => import('../games/mafia/Mafia'));
const DarkStories = lazy(() => import('../games/dark-stories/DarkStories'));
const WhoWouldRather = lazy(() => import('../games/who-would-rather/WhoWouldRather'));
const KtoNajpredzej = lazy(() => import('../games/kto-najpredzej/KtoNajpredzej'));
const ComingSoonGame = lazy(() => import('../components/ComingSoonGame'));

function GameRouter({
    selectedGameType,
    currentGameMeta,
    effectiveIsHost,
    handleLeaveRoom,
    handleCloseRoom,
    playerName,
    myPlayerId,
    vibrationEnabled,
    isRoomLocked,
    roomId,
    hostShareOptions,
}) {
    const tablePlayers = useRoomPlayers();
    const { t } = useLocale();

    return (
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

            {selectedGameType && isGameComingSoon(selectedGameType) && currentGameMeta && (
                <ComingSoonGame
                    title={currentGameMeta.name}
                    isHost={effectiveIsHost}
                    onLeave={handleLeaveRoom}
                />
            )}
        </Suspense>
    );
}

export default memo(GameRouter);
