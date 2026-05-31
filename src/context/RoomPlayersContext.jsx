import { createContext, useContext } from 'react';

const RoomPlayersContext = createContext([]);

export function RoomPlayersProvider({ playersList, children }) {
    return (
        <RoomPlayersContext.Provider value={playersList}>
            {children}
        </RoomPlayersContext.Provider>
    );
}

export function useRoomPlayers() {
    return useContext(RoomPlayersContext);
}
