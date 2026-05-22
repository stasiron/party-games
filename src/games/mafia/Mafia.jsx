import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ref, set, update } from 'firebase/database';
import { db } from '../../lib/firebase';
import gameData from '../../data/gameContent.json';
import { useRoomGameState } from '../../lib/useRoomGameState';
import ConfirmButton from '../../components/ConfirmButton';
import RoomInviteQR from '../../components/RoomInviteQR';
import GameRules from '../../components/GameRules';

function Mafia({ isHost, onLeave, myPlayerId, tablePlayers = [], roomInviteUrl }) {
    const defaultRoomState = useMemo(() => ({ phase: 'lobby', playersData: {} }), []);
    const roomData = useRoomGameState('mafia', defaultRoomState);

    const [roleCounts, setRoleCounts] = useState({});
    const [showRole, setShowRole] = useState(false);
    const lastPresetCountRef = useRef(-1);

    const lobbyPlayers = useMemo(() => {
        if (!isHost || roomData.phase !== 'lobby') return [];
        return tablePlayers
            .filter((p) => !p.isHost && p.isOnline !== false)
            .map((p) => ({ id: p.id, name: p.name, isHost: p.isHost, isOnline: p.isOnline }));
    }, [isHost, roomData.phase, tablePlayers]);

    const suggestedRoleCounts = useMemo(() => {
        const count = lobbyPlayers.length;
        if (count === 0) return {};
        const presetKey = count > 10 ? '10' : count.toString();
        const preset = gameData.mafia.presets[presetKey];
        if (preset) return preset;
        return { mafia: 0, lekarz: 0, agent: 0, jester: 0, lovers: 0, obywatel: count };
    }, [lobbyPlayers.length]);

    useEffect(() => {
        if (!isHost || roomData.phase !== 'lobby') return;
        const count = lobbyPlayers.length;
        if (count === lastPresetCountRef.current) return;
        lastPresetCountRef.current = count;
        const t = setTimeout(() => setRoleCounts(suggestedRoleCounts), 0);
        return () => clearTimeout(t);
    }, [isHost, roomData.phase, lobbyPlayers.length, suggestedRoleCounts]);

    // OPTYMALIZACJA CPU: Zmiana licznika ról (Cachowana przez useCallback)
    const changeRoleCount = useCallback((roleId, delta) => {
        setRoleCounts(prev => {
            const current = prev[roleId] || 0;
            const newValue = current + delta;
            if (newValue < 0) return prev;
            return { ...prev, [roleId]: newValue };
        });
    }, []);

    // OPTYMALIZACJA ENERGII: Sumowanie ról tylko wtedy, kiedy faktycznie zmieni się stan roleCounts
    const totalRolesAssigned = useMemo(() => {
        return Object.values(roleCounts).reduce((a, b) => a + b, 0);
    }, [roleCounts]);

    // MECHANIKA LOSOWANIA I ROZPOCZYNANIA ROZGRYWKI
    const startGame = useCallback(() => {
        if (lobbyPlayers.length === 0) return alert("Brak graczy do gry!");
        if (totalRolesAssigned !== lobbyPlayers.length) {
            return alert(`Suma ról (${totalRolesAssigned}) musi równać się liczbie graczy (${lobbyPlayers.length})!`);
        }

        let rolesPool = [];
        Object.keys(roleCounts).forEach(roleId => {
            for (let i = 0; i < roleCounts[roleId]; i++) {
                rolesPool.push(roleId);
            }
        });

        // Algorytm tasowania puli ról (Fisher-Yates Shuffle)
        for (let i = rolesPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
        }

        const newPlayersData = {};
        lobbyPlayers.forEach((player, index) => {
            newPlayersData[player.id] = {
                name: player.name,
                role: rolesPool[index],
                isAlive: true
            };
        });

        set(ref(db, 'rooms/mafia/gameState'), {
            phase: 'playing',
            playersData: newPlayersData
        });
    }, [lobbyPlayers, totalRolesAssigned, roleCounts]);

    // OZNACZANIE OFIAR PRZEZ MISTRZA GRY
    const togglePlayerAlive = useCallback((playerId, currentStatus) => {
        update(ref(db, `rooms/mafia/gameState/playersData/${playerId}`), {
            isAlive: !currentStatus
        });
    }, []);

    // RESETOWANIE STOŁU DO USTAWIEŃ POCZĄTKOWYCH
    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/mafia/gameState'), null);
        setShowRole(false);
    }, []);

    // POBIERANIE ROLI DLA AKTUALNEGO KLIENTA
    const myData = roomData.playersData[myPlayerId];
    const myRoleInfo = useMemo(() => {
        return myData ? gameData.mafia.roles.find(r => r.id === myData.role) : null;
    }, [myData]);

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    <GameRules title="Mafia">
                        <ol className="game-rules__list">
                            <li>Mistrz Gry (Host) dobiera role tak, by suma ról = liczba graczy przy stole.</li>
                            <li>Po rozdaniu każdy podgląda tajną rolę na telefonie. Mafia zna swoich wspólników.</li>
                            <li>Fazy nocy i dnia prowadzicie głosowo — aplikacja służy Mistrzowi do oznaczania żywych i martwych.</li>
                            <li>Miasto wygrywa, gdy wyeliminuje Mafię. Mafia wygrywa, gdy przejmie miasto.</li>
                        </ol>
                    </GameRules>

                    {isHost ? (
                        <div className="mafia-host-panel">
                            <h2 className="mafia-title-pink">Panel Mistrza Gry</h2>
                            <p>Aktywni gracze (bez Ciebie): <strong>{lobbyPlayers.length}</strong></p>

                            <div className="mafia-role-config-box">
                                <h3 className="mafia-role-config-title">Skonfiguruj role:</h3>

                                {gameData.mafia.roles.map(role => (
                                    <div key={role.id} className="mafia-role-row">
                                        <span className="mafia-role-name">{role.name}</span>
                                        <div className="mafia-role-controls">
                                            <button onClick={() => changeRoleCount(role.id, -1)} className="btn-mafia-counter">-</button>
                                            <span className="mafia-role-count">{roleCounts[role.id] || 0}</span>
                                            <button onClick={() => changeRoleCount(role.id, 1)} className="btn-mafia-counter">+</button>
                                        </div>
                                    </div>
                                ))}

                                <div className="mafia-role-summary">
                                    <span className={totalRolesAssigned === lobbyPlayers.length ? 'text-ok' : 'text-error'}>
                                        Przypisano: {totalRolesAssigned} / {lobbyPlayers.length}
                                    </span>
                                </div>
                            </div>

                            <div className="actions-stack">
                                <button
                                    onClick={startGame}
                                    disabled={totalRolesAssigned !== lobbyPlayers.length || lobbyPlayers.length === 0}
                                    className={`btn-mafia-start ${totalRolesAssigned === lobbyPlayers.length && lobbyPlayers.length > 0 ? 'active' : 'disabled'}`}
                                >
                                    Rozdaj role i rozpocznij
                                </button>
                            </div>
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </div>
                    ) : (
                        <div>
                            <h2>Mafia (Mistrz Gry: Oczekuje)</h2>
                            <p className="mafia-waiting-text">Zaczekaj, aż Mistrz Gry dobierze talie ról i rozpocznie grę...</p>
                        </div>
                    )}
                </div>
            ) : (
                <div>
                    {isHost ? (
                        <div>
                            <h2 className="mafia-title-pink">Księga Mistrza Gry</h2>
                            <p className="mafia-gm-desc">Masz podgląd na wszystko. Oznaczaj ofiary klikając "Zabij/Ożyw".</p>

                            <div className="mafia-players-grid">
                                {Object.keys(roomData.playersData).map(pId => {
                                    const p = roomData.playersData[pId];
                                    const roleDef = gameData.mafia.roles.find(r => r.id === p.role);
                                    return (
                                        <div key={pId} className={`mafia-player-card ${p.isAlive ? 'alive' : 'dead'}`}>
                                            <div>
                                                <span className={`mafia-player-name ${!p.isAlive ? 'crossed' : ''}`}>{p.name}</span>
                                                <br />
                                                <span className="mafia-player-role">Rola: {roleDef?.name}</span>
                                            </div>
                                            <button
                                                onClick={() => togglePlayerAlive(pId, p.isAlive)}
                                                className={`btn-mafia-kill ${p.isAlive ? 'kill' : 'revive'}`}
                                            >
                                                {p.isAlive ? '☠️ Zabij' : '❤️ Ożyw'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="bottom-controls">
                                <ConfirmButton onClick={forceResetTable} text="Zakończ grę i wróć do Setupu" className="w-100" />
                            </div>
                        </div>
                    ) : (
                        <div>
                            {myData?.isAlive ? (
                                <>
                                    <p className="mafia-secret-desc">Gra się rozpoczęła. Twoja rola pozostaje tajna.</p>
                                    <div
                                        onMouseDown={() => setShowRole(true)}
                                        onMouseUp={() => setShowRole(false)}
                                        onMouseLeave={() => setShowRole(false)}
                                        onTouchStart={() => setShowRole(true)}
                                        onTouchEnd={() => setShowRole(false)}
                                        className={`peek-panel mafia-peeking-box ${showRole ? 'active' : 'hidden'}`}
                                    >
                                        {!showRole ? (
                                            <h3 className="peek-hidden-text">Kliknij i przytrzymaj, aby podejrzeć rolę</h3>
                                        ) : (
                                            <>
                                                <span className="mafia-identity-label">Twoja tożsamość</span>
                                                <h2 className="mafia-identity-title">
                                                    {myRoleInfo?.name}
                                                </h2>
                                                <p className="mafia-identity-desc">
                                                    {myRoleInfo?.desc}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="mafia-dead-box">
                                    <h1 className="mafia-dead-icon">☠️</h1>
                                    <h2 className="mafia-dead-title">Nie żyjesz</h2>
                                    <p className="mafia-dead-desc">Twoja rola to był: <strong>{myRoleInfo?.name}</strong>. Nie odzywaj się do końca gry!</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton onClick={onLeave} text="Wyjdź z pokoju" className="w-100" />
            </div>
        </div>
    );
}

export default Mafia;