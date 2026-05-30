import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { ref } from 'firebase/database';

import { set, update } from '../../lib/rtdb';

import { db } from '../../lib/firebase';

import gameData from '../../data/gameContent.js';

import { useRoomGameState } from '../../lib/useRoomGameState';

import { usePiGameSession } from '../../lib/usePiGameSession';

import ConfirmButton from '../../components/ConfirmButton';

import GameRules from '../../components/GameRules';

import { HostShareOptions } from '../../components/RoomInviteQR';

import { getTablePlayers, getGuestsForOwner } from '../../lib/guestPlayers';

import SharedPhoneRoleReveal from '../../components/SharedPhoneRoleReveal';
import { buildRolesPool, assignRolesToPlayers, sumAssignedRoles } from './engine';



function Mafia({ isHost, onLeave, myPlayerId, tablePlayers = [], isRoomLocked = false, roomId, shareOptions }) {

    const defaultRoomState = useMemo(

        () => ({ phase: 'lobby', playersData: {}, roleRevealEpoch: 0 }),

        []

    );

    const roomData = useRoomGameState(roomId, defaultRoomState, { mergeDefaults: true });

    const roleRevealEpoch = roomData.roleRevealEpoch ?? 0;



    usePiGameSession(roomData.phase !== 'lobby');



    const [roleCounts, setRoleCounts] = useState({});

    const [showRole, setShowRole] = useState(false);

    const [hostRevealActive, setHostRevealActive] = useState(false);

    const lastPresetCountRef = useRef(-1);



    const lobbyPlayers = useMemo(() => {

        if (!isHost || roomData.phase !== 'lobby') return [];

        return getTablePlayers(tablePlayers)

            .filter((p) => !p.isHost)

            .map((p) => ({ id: p.id, name: p.name, isHost: p.isHost, isOnline: p.isOnline }));

    }, [isHost, roomData.phase, tablePlayers]);



    const myLinkedGuests = useMemo(

        () => getGuestsForOwner(tablePlayers, myPlayerId),

        [tablePlayers, myPlayerId]

    );



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



    const effectiveShowRole = showRole && roomData.phase === 'playing';
    const effectiveHostRevealActive = hostRevealActive && roomData.phase === 'playing';



    const changeRoleCount = useCallback((roleId, delta) => {

        setRoleCounts((prev) => {

            const current = prev[roleId] || 0;

            const newValue = current + delta;

            if (newValue < 0) return prev;

            return { ...prev, [roleId]: newValue };

        });

    }, []);



    const totalRolesAssigned = useMemo(() => {
        return sumAssignedRoles(roleCounts);

    }, [roleCounts]);

    const roleById = useMemo(() => {
        const nextMap = new Map();
        for (const role of gameData.mafia.roles) {
            nextMap.set(role.id, role);
        }
        return nextMap;
    }, []);



    const startGame = useCallback(() => {

        if (lobbyPlayers.length === 0) return alert('Brak graczy do gry!');

        if (totalRolesAssigned !== lobbyPlayers.length) {

            return alert(

                `Suma ról (${totalRolesAssigned}) musi równać się liczbie graczy (${lobbyPlayers.length})!`

            );

        }



        const rolesPool = buildRolesPool(roleCounts);
        const newPlayersData = assignRolesToPlayers(lobbyPlayers, rolesPool);



        set(ref(db, `rooms/${roomId}/gameState`), {

            phase: 'playing',

            playersData: newPlayersData,

            roleRevealEpoch: 1,

            revealAllRoles: false,

        });

    }, [lobbyPlayers, totalRolesAssigned, roleCounts, roomId]);



    const togglePlayerAlive = useCallback((playerId, currentStatus) => {

        update(ref(db, `rooms/${roomId}/gameState/playersData/${playerId}`), {

            isAlive: !currentStatus,

        });

    }, [roomId]);



    const replayRoles = useCallback(async () => {

        if (isRoomLocked) return;

        await update(ref(db, `rooms/${roomId}/gameState`), {

            roleRevealEpoch: roleRevealEpoch + 1,

        });

        setShowRole(false);

    }, [isRoomLocked, roleRevealEpoch, roomId]);



    const forceResetTable = useCallback(() => {

        set(ref(db, `rooms/${roomId}/gameState`), null);

        setShowRole(false);

        setHostRevealActive(false);

    }, [roomId]);



    const myData = roomData.playersData?.[myPlayerId];

    const myRoleInfo = useMemo(() => {

        return myData ? roleById.get(myData.role) || null : null;

    }, [myData, roleById]);



    const renderGuestRole = useCallback(

        (guest) => {

            const guestData = roomData.playersData?.[guest.id];

            const guestRole = guestData

                ? roleById.get(guestData.role) || null

                : null;

            return (

                <>

                    <span className="mafia-identity-label">Rola gościa: {guest.name}</span>

                    <h2 className="mafia-identity-title">{guestRole?.name ?? '—'}</h2>

                    <p className="mafia-identity-desc">{guestRole?.desc ?? ''}</p>

                </>

            );

        },

        [roomData.playersData, roleById]

    );



    const hostGuestRevealBlock =

        myLinkedGuests.length > 0 ? (

            <div className="mafia-host-reveal-zone">

                {!effectiveHostRevealActive ? (

                    <button

                        type="button"

                        className="btn-accent mafia-host-reveal-toggle"

                        onClick={() => setHostRevealActive(true)}

                    >

                        Pokaż role gościom (ukryj panel sterowania)

                    </button>

                ) : (

                    <>

                        <p className="mafia-host-reveal-notice">

                            Tryb bezpieczny — panel Mistrza Gry jest ukryty. Nikt nie zobaczy ról przy

                            oznaczaniu ofiar.

                        </p>

                        <SharedPhoneRoleReveal

                            skipOwnerStep

                            guests={myLinkedGuests}

                            resetEpoch={roleRevealEpoch}

                            peekPanelExtraClass="mafia-peeking-box"

                            ownerPeekClassName="active"

                            peekHiddenClassName="hidden"

                            secretWarning="Ukryj ekran przed innymi!"

                            renderOwnerReveal={() => null}

                            renderGuestReveal={renderGuestRole}

                        />

                        <button

                            type="button"

                            className="btn-mafia-back-panel"

                            onClick={() => setHostRevealActive(false)}

                        >

                            Zakończ podgląd — wróć do panelu Mistrza Gry

                        </button>

                    </>

                )}

            </div>

        ) : null;
    const revealAllRoles = roomData.revealAllRoles === true && roomData.phase === 'playing';



    return (

        <div>

            {roomData.phase === 'lobby' ? (

                <div>

                    <GameRules title="🌃 Mafia">

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

                            <p>

                                Aktywni gracze (bez Ciebie): <strong>{lobbyPlayers.length}</strong>

                            </p>



                            <div className="mafia-role-config-box">

                                <h3 className="mafia-role-config-title">Skonfiguruj role:</h3>



                                {gameData.mafia.roles.map((role) => (

                                    <div key={role.id} className="mafia-role-row">

                                        <span className="mafia-role-name">{role.name}</span>

                                        <div className="mafia-role-controls">

                                            <button

                                                onClick={() => changeRoleCount(role.id, -1)}

                                                className="btn-mafia-counter"

                                            >

                                                -

                                            </button>

                                            <span className="mafia-role-count">{roleCounts[role.id] || 0}</span>

                                            <button

                                                onClick={() => changeRoleCount(role.id, 1)}

                                                className="btn-mafia-counter"

                                            >

                                                +

                                            </button>

                                        </div>

                                    </div>

                                ))}



                                <div className="mafia-role-summary">

                                    <span

                                        className={

                                            totalRolesAssigned === lobbyPlayers.length

                                                ? 'text-ok'

                                                : 'text-error'

                                        }

                                    >

                                        Przypisano: {totalRolesAssigned} / {lobbyPlayers.length}

                                    </span>

                                </div>

                            </div>



                            <div className="actions-stack">

                                <button

                                    onClick={startGame}

                                    disabled={

                                        totalRolesAssigned !== lobbyPlayers.length ||

                                        lobbyPlayers.length === 0

                                    }

                                    className={`btn-mafia-start ${totalRolesAssigned === lobbyPlayers.length && lobbyPlayers.length > 0 ? 'active' : 'disabled'}`}

                                >

                                    Rozdaj role i rozpocznij

                                </button>

                            </div>

                            <HostShareOptions shareOptions={shareOptions} />

                        </div>

                    ) : (

                        <div>

                            <h2>Mafia (Mistrz Gry: Oczekuje)</h2>

                            <p className="mafia-waiting-text">

                                Zaczekaj, aż Mistrz Gry dobierze talie ról i rozpocznie grę...

                            </p>

                        </div>

                    )}

                </div>

            ) : (

                <div>
                    {revealAllRoles && (
                        <div className="mafia-host-panel">
                            <h2 className="mafia-title-pink">ADMIN REVEAL: Role ujawnione</h2>
                            <div className="mafia-players-grid">
                                {Object.keys(roomData.playersData || {}).map((pId) => {
                                    const p = roomData.playersData[pId];
                                    const roleDef = roleById.get(p.role);
                                    return (
                                        <div key={pId} className={`mafia-player-card ${p.isAlive ? 'alive' : 'dead'}`}>
                                            <span className="mafia-player-name">{p.name}</span>
                                            <span className="mafia-player-role">Rola: {roleDef?.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {isHost ? (

                        <div>

                            {hostGuestRevealBlock}



                            {!effectiveHostRevealActive && (

                                <>

                                    <h2 className="mafia-title-pink">Księga Mistrza Gry</h2>

                                    <p className="mafia-gm-desc">

                                        Masz podgląd na wszystko. Oznaczaj ofiary klikając &quot;Zabij/Ożyw&quot;.

                                    </p>



                                    <div className="mafia-players-grid">

                                        {Object.keys(roomData.playersData || {}).map((pId) => {

                                            const p = roomData.playersData[pId];

                                            const roleDef = roleById.get(p.role);

                                            return (

                                                <div

                                                    key={pId}

                                                    className={`mafia-player-card ${p.isAlive ? 'alive' : 'dead'}`}

                                                >

                                                    <div>

                                                        <span

                                                            className={`mafia-player-name ${!p.isAlive ? 'crossed' : ''}`}

                                                        >

                                                            {p.name}

                                                        </span>

                                                        <br />

                                                        <span className="mafia-player-role">

                                                            Rola: {roleDef?.name}

                                                        </span>

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



                                    <HostShareOptions shareOptions={shareOptions} />

                                    <div className="bottom-controls">

                                        <ConfirmButton

                                            onClick={forceResetTable}

                                            text="Zakończ grę i wróć do Setupu"

                                            className="w-100"

                                        />

                                    </div>

                                </>

                            )}

                        </div>

                    ) : (

                        <div>

                            {myData?.isAlive ? (

                                <>

                                    <p className="mafia-secret-desc">

                                        Gra się rozpoczęła. Twoja rola pozostaje tajna.

                                    </p>

                                    {myLinkedGuests.length > 0 ? (

                                        <SharedPhoneRoleReveal

                                            resetEpoch={roleRevealEpoch}

                                            guests={myLinkedGuests}

                                            peekPanelExtraClass="mafia-peeking-box"

                                            ownerPeekClassName="active"

                                            peekHiddenClassName="hidden"

                                            secretWarning="Ukryj ekran przed innymi!"

                                            renderOwnerReveal={() => (

                                                <>

                                                    <span className="mafia-identity-label">Twoja tożsamość</span>

                                                    <h2 className="mafia-identity-title">{myRoleInfo?.name}</h2>

                                                    <p className="mafia-identity-desc">{myRoleInfo?.desc}</p>

                                                </>

                                            )}

                                            renderGuestReveal={renderGuestRole}

                                        />

                                    ) : (

                                        <div

                                            onMouseDown={() => setShowRole(true)}

                                            onMouseUp={() => setShowRole(false)}

                                            onMouseLeave={() => setShowRole(false)}

                                            onTouchStart={() => setShowRole(true)}

                                            onTouchEnd={() => setShowRole(false)}

                                            className={`peek-panel mafia-peeking-box ${effectiveShowRole ? 'active' : 'hidden'}`}

                                        >

                                            {!effectiveShowRole ? (

                                                <h3 className="peek-hidden-text">

                                                    Kliknij i przytrzymaj, aby podejrzeć rolę

                                                </h3>

                                            ) : (

                                                <>

                                                    <span className="mafia-identity-label">Twoja tożsamość</span>

                                                    <h2 className="mafia-identity-title">{myRoleInfo?.name}</h2>

                                                    <p className="mafia-identity-desc">{myRoleInfo?.desc}</p>

                                                </>

                                            )}

                                        </div>

                                    )}

                                </>

                            ) : (

                                <div className="mafia-dead-box">

                                    <h1 className="mafia-dead-icon">☠️</h1>

                                    <h2 className="mafia-dead-title">Nie żyjesz</h2>

                                    <p className="mafia-dead-desc">

                                        Twoja rola to był: <strong>{myRoleInfo?.name}</strong>. Nie odzywaj się

                                        do końca gry!

                                    </p>

                                </div>

                            )}

                        </div>

                    )}



                    {!isRoomLocked && roomData.phase === 'playing' && (

                        <div className="role-replay-bar">

                            <button type="button" className="btn-role-replay" onClick={replayRoles}>
                                Pokaż role ponownie (wszyscy przy telefonach)
                            </button>
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

