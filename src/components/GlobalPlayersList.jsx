import { memo } from 'react';

function GlobalPlayersList({ players, isAdminMode, onAdminKick }) {
    if (players.length === 0) {
        return <span className="empty-room-text">Brak graczy online. Rozpocznij imprezę!</span>;
    }

    return players.map((p) => {
        const [gameId, pid] = p.id.split(':');
        return (
            <span key={p.id} className={`player-tag ${p.isOnline === false ? 'player-offline' : ''}`}>
                {p.name} <span className="global-player-game">({p.gameName})</span> {p.isOnline === false && '💤'}
                {isAdminMode && (
                    <button
                        type="button"
                        onClick={() => onAdminKick(gameId, pid)}
                        className="btn-admin-kick"
                        title="Admin: wyrzuć gracza"
                    >
                        🛑
                    </button>
                )}
            </span>
        );
    });
}

export default memo(GlobalPlayersList);
