import { useEffect } from 'react';
import { resolveGameId } from '../../data/gameIds.js';
import { getComingSoonMessage, isGameComingSoon } from '../../lib/gameCatalog.js';
import { prefetchGameChunk } from '../../lib/prefetchGameChunk';

/**
 * Wejście z URL: ?room= i ?game=
 */
export function useDeepLinkEntry({
    openRoomAsGuestRef,
    createHostRoomRef,
    setLobbyMessage,
    setEntryRole,
    setIsHost,
    t,
}) {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = (params.get('room') || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        if (!roomFromUrl) return undefined;
        const timer = setTimeout(() => {
            void openRoomAsGuestRef.current?.(roomFromUrl, { joinViaInvite: true });
        }, 0);
        return () => clearTimeout(timer);
    }, [openRoomAsGuestRef]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = (params.get('room') || '').trim();
        if (roomFromUrl) return undefined;

        const rawGame = (params.get('game') || '').trim();
        if (!rawGame) return undefined;

        const gameId = resolveGameId(rawGame);
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('game');
            window.history.replaceState({}, '', url.toString());
        } catch {
            /* ignore URL cleanup */
        }

        if (!gameId) {
            setLobbyMessage(t('errors.unknownGame', { game: rawGame }));
            return undefined;
        }

        if (isGameComingSoon(gameId)) {
            setLobbyMessage(getComingSoonMessage(gameId, t));
            return undefined;
        }

        prefetchGameChunk(gameId);
        setEntryRole('host');
        setIsHost(true);
        const timer = setTimeout(() => {
            createHostRoomRef.current?.(gameId);
        }, 0);
        return () => clearTimeout(timer);
    }, [createHostRoomRef, setEntryRole, setIsHost, setLobbyMessage, t]);
}
