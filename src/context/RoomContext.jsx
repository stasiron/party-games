import { createContext, useContext } from 'react';

const RoomContext = createContext(null);

export function RoomProvider({ value, children }) {
    return (
        <RoomContext.Provider value={value}>
            {children}
        </RoomContext.Provider>
    );
}

export function useRoom() {
    const ctx = useContext(RoomContext);
    if (!ctx) {
        throw new Error('useRoom must be used within RoomProvider');
    }
    return ctx;
}
