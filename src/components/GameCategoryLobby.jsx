import CategorySelectionGrid from './CategorySelectionGrid';
import { HostShareOptions } from './RoomInviteQR';
import { useLocale } from '../locales/LocaleContext';
import { getLobbyWaitMessage } from '../lib/room/gameRoomContract';

function GameCategoryLobby({
    isHost,
    gameId,
    categories,
    selectedIds,
    onToggle,
    onStart,
    selectPrompt,
    startLabel,
    guestWaitMessage,
    shareOptions,
    canStart,
    children,
}) {
    const { t } = useLocale();
    const prompt = selectPrompt ?? t('gameLobby.selectCategories');
    const start = startLabel ?? t('gameLobby.startGame');
    const guestWait = guestWaitMessage
        ?? (gameId ? getLobbyWaitMessage(t, gameId) : t('gameLobby.waitForHost'));
    const startDisabled = canStart !== undefined ? !canStart : selectedIds.length === 0;

    if (!isHost) {
        return <p>{guestWait}</p>;
    }

    return (
        <>
            {prompt && <p>{prompt}</p>}
            {children}
            <CategorySelectionGrid
                categories={categories}
                selectedIds={selectedIds}
                onToggle={onToggle}
            />
            <div className="lobby-start-actions actions-stack">
                <button
                    type="button"
                    onClick={onStart}
                    className="btn-accent btn-lobby-start"
                    disabled={startDisabled}
                >
                    {start} ({selectedIds.length})
                </button>
            </div>
            <HostShareOptions shareOptions={shareOptions} />
        </>
    );
}

export default GameCategoryLobby;
