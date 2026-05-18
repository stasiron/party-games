import { useState, useEffect } from 'react';
import { ref, set, onValue, update } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import ConfirmButton from './ConfirmButton';

function Mafia({ isHost, onLeave, myPlayerId }) {
    const [roomData, setRoomData] = useState({
        phase: 'lobby',
        playersData: {}
    });

    const [lobbyPlayers, setLobbyPlayers] = useState([]);
    const [roleCounts, setRoleCounts] = useState({});
    const [showRole, setShowRole] = useState(false);

    useEffect(() => {
        const roomRef = ref(db, 'rooms/mafia/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData(data);
            } else {
                setRoomData({ phase: 'lobby', playersData: {} });
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!isHost || roomData.phase !== 'lobby') return;

        const playersRef = ref(db, 'rooms/mafia/players');
        const unsubscribe = onValue(playersRef, (snapshot) => {
            const data = snapshot.val() || {};
            const activePlayers = Object.keys(data)
                .map(key => ({ id: key, ...data[key] }))
                .filter(p => !p.isHost && p.isOnline !== false);

            setLobbyPlayers(activePlayers);
        });

        return () => unsubscribe();
    }, [isHost, roomData.phase]);

    useEffect(() => {
        if (!isHost || roomData.phase !== 'lobby') return;

        const count = lobbyPlayers.length;
        if (count === 0) return;

        const presetKey = count > 10 ? "10" : count.toString();
        const preset = gameData.mafia.presets[presetKey];

        if (preset) {
            setRoleCounts(preset);
        } else {
            setRoleCounts({ mafia: 0, lekarz: 0, agent: 0, jester: 0, lovers: 0, obywatel: count });
        }
    }, [lobbyPlayers.length, isHost, roomData.phase]);

    const changeRoleCount = (roleId, delta) => {
        setRoleCounts(prev => {
            const current = prev[roleId] || 0;
            const newValue = current + delta;
            if (newValue < 0) return prev;
            return { ...prev, [roleId]: newValue };
        });
    };

    const totalRolesAssigned = Object.values(roleCounts).reduce((a, b) => a + b, 0);

    const startGame = () => {
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
    };

    // Optymalizacja: Użycie update() zapobiega nadpisywaniu całego stanu przez Hosta
    const togglePlayerAlive = (playerId, currentStatus) => {
        update(ref(db, `rooms/mafia/gameState/playersData/${playerId}`), {
            isAlive: !currentStatus
        });
    };

    const forceResetTable = () => {
        set(ref(db, 'rooms/mafia/gameState'), null);
        setShowRole(false);
    };

    const myData = roomData.playersData[myPlayerId];
    const myRoleInfo = myData ? gameData.mafia.roles.find(r => r.id === myData.role) : null;

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    {isHost ? (
                        <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '16px' }}>
                            <h2 style={{ color: '#d63384' }}>Panel Mistrza Gry</h2>
                            <p>Aktywni gracze (bez Ciebie): <strong>{lobbyPlayers.length}</strong></p>

                            <div style={{ margin: '20px 0', padding: '15px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px' }}>
                                <h3 style={{ margin: '0 0 15px 0' }}>Skonfiguruj role:</h3>

                                {gameData.mafia.roles.map(role => (
                                    <div key={role.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                        <span style={{ fontWeight: 'bold' }}>{role.name}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                            <button onClick={() => changeRoleCount(role.id, -1)} style={{ padding: '5px 15px', minWidth: '40px' }}>-</button>
                                            <span style={{ width: '20px', textAlign: 'center', fontSize: '1.2rem' }}>{roleCounts[role.id] || 0}</span>
                                            <button onClick={() => changeRoleCount(role.id, 1)} style={{ padding: '5px 15px', minWidth: '40px' }}>+</button>
                                        </div>
                                    </div>
                                ))}

                                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed rgba(255,255,255,0.2)', textAlign: 'right' }}>
                                    <span style={{ color: totalRolesAssigned === lobbyPlayers.length ? '#44ff44' : '#ff4444', fontWeight: 'bold' }}>
                                        Przypisano: {totalRolesAssigned} / {lobbyPlayers.length}
                                    </span>
                                </div>
                            </div>

                            <button
                                onClick={startGame}
                                disabled={totalRolesAssigned !== lobbyPlayers.length || lobbyPlayers.length === 0}
                                style={{ backgroundColor: totalRolesAssigned === lobbyPlayers.length && lobbyPlayers.length > 0 ? '#d63384' : '#555', width: '100%', fontWeight: 'bold' }}
                            >
                                Rozdaj role i rozpocznij
                            </button>
                        </div>
                    ) : (
                        <div>
                            <h2>Mafia (Mistrz Gry: Oczekuje)</h2>
                            <p style={{ opacity: 0.8 }}>Zaczekaj, aż Mistrz Gry dobierze talie ról i rozpocznie grę...</p>
                        </div>
                    )}
                </div>
            ) : (
                <div>
                    {isHost ? (
                        <div>
                            <h2 style={{ color: '#d63384' }}>Księga Mistrza Gry</h2>
                            <p style={{ opacity: 0.8, marginBottom: '20px' }}>Masz podgląd na wszystko. Oznaczaj ofiary klikając "Zabij/Ożyw".</p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {Object.keys(roomData.playersData).map(pId => {
                                    const p = roomData.playersData[pId];
                                    const roleDef = gameData.mafia.roles.find(r => r.id === p.role);
                                    return (
                                        <div key={pId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: p.isAlive ? 'rgba(42, 17, 58, 0.8)' : 'rgba(255, 0, 0, 0.2)', padding: '15px', borderRadius: '8px', border: p.isAlive ? '1px solid rgba(255,255,255,0.1)' : '1px solid #ff4444' }}>
                                            <div>
                                                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', textDecoration: p.isAlive ? 'none' : 'line-through' }}>{p.name}</span>
                                                <br />
                                                <span style={{ color: '#ffd700', fontSize: '0.9rem' }}>Rola: {roleDef?.name}</span>
                                            </div>
                                            <button
                                                onClick={() => togglePlayerAlive(pId, p.isAlive)}
                                                style={{ backgroundColor: p.isAlive ? '#ff4444' : '#44ff44', color: '#fff', padding: '8px 15px', fontSize: '0.9rem' }}
                                            >
                                                {p.isAlive ? '☠️ Zabij' : '❤️ Ożyw'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ marginTop: '30px', display: 'flex', justifyContent: 'center' }}>
                                <ConfirmButton onClick={forceResetTable} text="Zakończ grę i wróć do Setupu" style={{ width: '100%' }} />
                            </div>
                        </div>
                    ) : (
                        <div>
                            {myData?.isAlive ? (
                                <>
                                    <p style={{ textAlign: 'center', opacity: 0.8, marginBottom: '20px' }}>Gra się rozpoczęła. Twoja rola pozostaje tajna.</p>
                                    <div
                                        onMouseDown={() => setShowRole(true)}
                                        onMouseUp={() => setShowRole(false)}
                                        onMouseLeave={() => setShowRole(false)}
                                        onTouchStart={() => setShowRole(true)}
                                        onTouchEnd={() => setShowRole(false)}
                                        style={{
                                            padding: '40px 20px',
                                            backgroundColor: showRole ? 'rgba(42, 17, 58, 0.8)' : 'rgba(0,0,0,0.3)',
                                            borderRadius: '16px',
                                            margin: '20px 0',
                                            minHeight: '200px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            border: showRole ? '2px solid #a855f7' : '2px solid transparent'
                                        }}
                                    >
                                        {!showRole ? (
                                            <h3 style={{ margin: 0, opacity: 0.5 }}>Kliknij i przytrzymaj, aby podejrzeć rolę</h3>
                                        ) : (
                                            <>
                                                <span style={{ fontSize: '1rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '2px' }}>Twoja tożsamość</span>
                                                <h2 style={{ margin: '10px 0', fontSize: '2.5rem', color: '#ffd700' }}>
                                                    {myRoleInfo?.name}
                                                </h2>
                                                <p style={{ textAlign: 'center', maxWidth: '80%', opacity: 0.9 }}>
                                                    {myRoleInfo?.desc}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div style={{ padding: '60px 20px', backgroundColor: 'rgba(255, 0, 0, 0.2)', borderRadius: '16px', border: '2px solid #ff4444', textAlign: 'center' }}>
                                    <h1 style={{ fontSize: '3rem', margin: '0 0 10px 0', color: '#ff4444' }}>☠️</h1>
                                    <h2 style={{ margin: 0, color: '#ff4444', textTransform: 'uppercase' }}>Nie żyjesz</h2>
                                    <p style={{ opacity: 0.8, marginTop: '10px' }}>Twoja rola to był: <strong>{myRoleInfo?.name}</strong>. Nie odzywaj się do końca gry!</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'center' }}>
                <ConfirmButton onClick={onLeave} text="Wyjdź z pokoju" style={{ width: '100%' }} />
            </div>
        </div>
    );
}

export default Mafia;