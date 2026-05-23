import { useState, useEffect, memo } from 'react';

/** Odliczanie migracji hosta — izolowane od App, żeby nie renderować całego drzewa co 1 s. */
function MigrationBanner({ hostLost, myPlayerId, isJoined, selectedGame, onMigrate }) {
    const [countdown, setCountdown] = useState(null);

    useEffect(() => {
        if (!hostLost || !myPlayerId || !isJoined || !selectedGame) {
            const reset = setTimeout(() => setCountdown(null), 0);
            return () => clearTimeout(reset);
        }

        const start = setTimeout(() => setCountdown(30), 0);
        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev === null || prev <= 1) {
                    clearInterval(timer);
                    onMigrate();
                    return null;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            clearTimeout(start);
            clearInterval(timer);
        };
    }, [hostLost, myPlayerId, isJoined, selectedGame, onMigrate]);

    if (countdown === null) return null;

    return (
        <div className="migration-warning">
            ⚠️ Host utracił połączenie. Przekazanie stołu za: {countdown}s...
        </div>
    );
}

export default memo(MigrationBanner);
