import { useCallback, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { get as rtdbGet } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import { ROOMS_PUBLIC_ROOT } from '../../lib/roomIndex';
import { applyLobbyFilters } from '../../lib/roomPublicSync';
import { getRoomsPublicDebounceMs, saveLobbyFilters } from '../../lib/lobbyFilters';
import { buildActiveRoomsFromPublic, fingerprintActiveRoomsList } from '../utils/activeRooms';

/** Subskrypcja roomsPublic dla lobby gościa. */
export function useGuestRoomsList({
    selectedGame,
    entryRole,
    gameById,
    lobbyFilters,
    t,
    setActiveRooms,
    setGuestRoomsListReady,
    setGuestRoomsRefreshing,
}) {
    const lastPublicSnapshotRef = useRef(null);
    const lastActiveRoomsFingerprintRef = useRef('');
    const guestRoomsRefreshInFlightRef = useRef(false);

    const processPublicRoomsSnapshot = useCallback((raw) => {
        let rooms = buildActiveRoomsFromPublic(raw || {}, gameById);
        rooms = rooms.map((room) => ({
            ...room,
            gameName: t(`games.${room.gameId}.name`, {}, room.gameName),
        }));
        rooms = applyLobbyFilters(rooms, lobbyFilters);
        const fingerprint = fingerprintActiveRoomsList(rooms);
        if (fingerprint !== lastActiveRoomsFingerprintRef.current) {
            lastActiveRoomsFingerprintRef.current = fingerprint;
            setActiveRooms(rooms);
        }
        setGuestRoomsListReady(true);
    }, [gameById, lobbyFilters, t, setActiveRooms, setGuestRoomsListReady]);

    const refreshGuestRooms = useCallback(async () => {
        if (guestRoomsRefreshInFlightRef.current) return;
        guestRoomsRefreshInFlightRef.current = true;
        setGuestRoomsRefreshing(true);
        try {
            const snapshot = await rtdbGet(ref(db, ROOMS_PUBLIC_ROOT));
            const raw = snapshot.val();
            lastPublicSnapshotRef.current = raw;
            processPublicRoomsSnapshot(raw);
        } finally {
            guestRoomsRefreshInFlightRef.current = false;
            setGuestRoomsRefreshing(false);
        }
    }, [processPublicRoomsSnapshot, setGuestRoomsRefreshing]);

    useEffect(() => {
        saveLobbyFilters(lobbyFilters);
        if (lastPublicSnapshotRef.current != null) {
            processPublicRoomsSnapshot(lastPublicSnapshotRef.current);
        }
    }, [lobbyFilters, processPublicRoomsSnapshot]);

    useEffect(() => {
        if (selectedGame || entryRole !== 'guest') return undefined;
        let cancelled = false;
        let timeoutId;
        let hasListed = false;
        const debounceMs = getRoomsPublicDebounceMs();

        const applySnapshot = (raw, { immediate = false } = {}) => {
            if (cancelled) return;
            lastPublicSnapshotRef.current = raw;
            clearTimeout(timeoutId);
            if (immediate || !hasListed) {
                hasListed = true;
                processPublicRoomsSnapshot(raw);
                return;
            }
            timeoutId = window.setTimeout(() => {
                if (!cancelled) processPublicRoomsSnapshot(lastPublicSnapshotRef.current);
            }, debounceMs);
        };

        const unsubPublic = onValue(ref(db, ROOMS_PUBLIC_ROOT), (snapshot) => {
            applySnapshot(snapshot.val(), { immediate: !hasListed });
        });

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
            unsubPublic();
            setActiveRooms([]);
            setGuestRoomsListReady(false);
            lastPublicSnapshotRef.current = null;
            lastActiveRoomsFingerprintRef.current = '';
        };
    }, [selectedGame, entryRole, processPublicRoomsSnapshot, setActiveRooms, setGuestRoomsListReady]);

    return { refreshGuestRooms };
}
