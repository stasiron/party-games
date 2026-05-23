import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { set, get, update } from '../lib/rtdb';
import { db, firebaseConnection, getPartyOrigin, PI_AP_GATEWAY } from '../lib/firebase';
import { debounce } from '../lib/debounce';
import gameData from '../data/gameContent.json';
import GlobalPlayersList from '../components/GlobalPlayersList';
import MigrationBanner from '../components/MigrationBanner';
import ConnectionStatus from '../components/ConnectionStatus';
import IosWifiHelp from '../components/IosWifiHelp';
import { useServerBusy } from '../context/useServerBusy';
import { useLongPress } from '../hooks/useLongPress';
import {
    isLowPowerDevice,
    getJoinGraceMs,
    getPresenceMissingGraceMs,
    getPlayersDebounceMs,
} from '../lib/lowPower';
import '../styles/app.css';

const NeverHaveIEver = lazy(() => import('../games/never-have-i-ever/NeverHaveIEver'));
const Impostor = lazy(() => import('../games/impostor/Impostor'));
const TruthOrDare = lazy(() => import('../games/truth-or-dare/TruthOrDare'));
const Mafia = lazy(() => import('../games/mafia/Mafia'));
const DarkStories = lazy(() => import('../games/dark-stories/DarkStories'));

const PRESENCE_DEBOUNCE_MS = 250;

const themePresets = [
    { id: 'default', label: 'Fioletowy (domyślny)', stops: ['#0a0f1e', '#2a113a', '#8c215e'] },
    { id: 'sunrise', label: 'Żółto-zielono-niebieski', stops: ['#f8ff70', '#3ad59f', '#0099ff'] },
    { id: 'sunset', label: 'Różowo-pomarańczowy', stops: ['#ff5f6d', '#ffb56b', '#ffd47f'] },
    { id: 'forest', label: 'Zielono-granatowy', stops: ['#1b5e20', '#0d3b66', '#1e88e5'] },
];

function App() {
    const { runWithBusy } = useServerBusy();
    const [selectedGame, setSelectedGame] = useState(null);
    const [playerName, setPlayerName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [nameError, setNameError] = useState('');

    const [playersList, setPlayersList] = useState([]);
    /** Tylko węzły `players` per gra — bez pobierania całego `rooms` (gameState / isLocked). */
    const [presenceByGame, setPresenceByGame] = useState({});
    const [myPlayerId, setMyPlayerId] = useState(null);
    const [hostExists, setHostExists] = useState(false);

    const [hostLost, setHostLost] = useState(false);
    const [isRoomLocked, setIsRoomLocked] = useState(false);

    const [lobbyMessage, setLobbyMessage] = useState(''); // Komunikat o wyrzuceniu widoczny w lobby
    const isLeavingVoluntarily = useRef(false);           // Odróżnia wyjście gracza od wyrzucenia przez Hosta

    // STANY: Dla tajnego panelu administratora pod logo
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [themePreset, setThemePreset] = useState('default');
    const [soundEnabled, setSoundEnabled] = useState(() => !isLowPowerDevice());
    const [vibrationEnabled, setVibrationEnabled] = useState(() => !isLowPowerDevice());
    const [adminCommand, setAdminCommand] = useState('');
    const [isAdminMode, setIsAdminMode] = useState(false);
    const toggleAdminPanel = useCallback(() => {
        setShowAdminPanel((prev) => !prev);
    }, []);
    const logoLongPress = useLongPress(toggleAdminPanel, { delayMs: 650 });
    const prevPlayersCountRef = useRef(0);
    const isHostRef = useRef(isHost);
    const soundEnabledRef = useRef(soundEnabled);
    const isJoinedRef = useRef(isJoined);
    const myPlayerIdRef = useRef(myPlayerId);
    const joinGraceUntilRef = useRef(0);
    const missingPlayerSinceRef = useRef(0);
    const isJoiningRef = useRef(false);
    const isOnlineHealSentRef = useRef(false);

    useEffect(() => {
        isHostRef.current = isHost;
        soundEnabledRef.current = soundEnabled;
        isJoinedRef.current = isJoined;
        myPlayerIdRef.current = myPlayerId;
    }, [isHost, soundEnabled, isJoined, myPlayerId]);

    const playJoinSound = useCallback(() => {
        if (!soundEnabled || typeof window === 'undefined') return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            const mainOsc = ctx.createOscillator();
            const mainGain = ctx.createGain();
            mainOsc.type = 'sine';
            mainOsc.frequency.value = 340;
            mainOsc.connect(mainGain);

            const delay = ctx.createDelay(0.5);
            const feedbackGain = ctx.createGain();
            const delayOutGain = ctx.createGain();
            delay.connect(feedbackGain);
            feedbackGain.connect(delay);
            delay.connect(delayOutGain);
            delayOutGain.connect(ctx.destination);

            mainGain.connect(ctx.destination);
            mainGain.connect(delay);

            mainGain.gain.setValueAtTime(0.0001, ctx.currentTime);
            mainGain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
            mainGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

            delay.delayTime.value = 0.09;
            feedbackGain.gain.value = 0.35;
            delayOutGain.gain.value = 0.28;

            mainOsc.start();

            const shimmerOsc = ctx.createOscillator();
            const shimmerGain = ctx.createGain();
            shimmerOsc.type = 'sine';
            shimmerOsc.frequency.value = 280;
            shimmerOsc.connect(shimmerGain);
            shimmerGain.connect(ctx.destination);
            shimmerGain.gain.setValueAtTime(0.0001, ctx.currentTime + 0.05);
            shimmerGain.gain.exponentialRampToValueAtTime(0.015, ctx.currentTime + 0.08);
            shimmerGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
            shimmerOsc.start(ctx.currentTime + 0.05);

            setTimeout(() => {
                try {
                    mainOsc.stop();
                    shimmerOsc.stop();
                    ctx.close();
                } catch {
                    /* WebAudio cleanup */
                }
            }, 420);
        } catch {
            /* brak WebAudio / polityka autoplay */
        }
    }, [soundEnabled]);

    const globalPlayersList = useMemo(() => {
        const all = [];
        for (const gameId of Object.keys(presenceByGame)) {
            const players = presenceByGame[gameId];
            if (!players) continue;
            const gameObj = gameData.games.find((g) => g.id === gameId);
            const roomLabel = gameObj ? gameObj.name : gameId;
            for (const pId of Object.keys(players)) {
                const p = players[pId];
                all.push({
                    id: `${gameId}:${pId}`,
                    gameName: roomLabel,
                    ...p,
                });
            }
        }
        return all;
    }, [presenceByGame]);

    const currentGameMeta = useMemo(
        () => (selectedGame ? gameData.games.find((g) => g.id === selectedGame) : null),
        [selectedGame]
    );

    /** Host z bazy (nie tylko przełącznik w lobby) — od tego zależy kick i zamykanie pokoju. */
    const effectiveIsHost = useMemo(() => {
        if (!isJoined || !myPlayerId) return isHost;
        const me = playersList.find((p) => p.id === myPlayerId);
        if (!me) return isHost;
        return me.isHost === true && me.isOnline !== false;
    }, [isJoined, myPlayerId, playersList, isHost]);

    /** Pełny adres z parametrem `game` — QR i kopiowanie (kanoniczny origin na Malinie). */
    const roomInviteUrl = useMemo(() => {
        if (!selectedGame || !isJoined || !effectiveIsHost || typeof window === 'undefined') return '';
        try {
            const base = getPartyOrigin() || window.location.origin;
            const u = new URL(base);
            u.searchParams.set('game', selectedGame);
            u.hash = '';
            return u.toString();
        } catch {
            return '';
        }
    }, [selectedGame, isJoined, effectiveIsHost]);

    // Wejście z linku / QR: ?game=<id_gry>
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const gameFromUrl = params.get('game');
        if (!gameFromUrl || !gameData.games.some((g) => g.id === gameFromUrl)) return;
        const t = setTimeout(() => {
            setSelectedGame(gameFromUrl);
            setLobbyMessage('');
            setShowAdminPanel(false);
        }, 0);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const preset = themePresets.find((preset) => preset.id === themePreset) || themePresets[0];
        const root = document.documentElement;
        root.style.setProperty('--bg-gradient-start', preset.stops[0]);
        root.style.setProperty('--bg-gradient-middle', preset.stops[1]);
        root.style.setProperty('--bg-gradient-end', preset.stops[2]);
    }, [themePreset]);

    // =========================================================================
    // POPRAWIONY EFEKT 1: NASŁUCHIWANIE GRACZY, SYSTEM ISKICKED I AUTOMATYCZNA CZYSTKA POKOJU
    // =========================================================================
    useEffect(() => {
        if (!selectedGame) return;

        let playersTimeoutId;
        let lastPlayersJson = '';

        const applyPlayersSnapshot = (data) => {
            const playersArray = Object.keys(data)
                .map((key) => ({
                    id: key,
                    ...data[key],
                }))
                .filter((p) => !p.isKicked);
            setPlayersList(playersArray);

            try {
                const newCount = playersArray.length;
                const prevCount = prevPlayersCountRef.current || 0;
                if (isHostRef.current && soundEnabledRef.current && prevCount > 0 && newCount > prevCount) {
                    playJoinSound();
                }
                prevPlayersCountRef.current = newCount;
            } catch {
                /* join sound */
            }

            const activeHost = playersArray.find(
                (player) => player.isHost === true && player.isOnline !== false
            );
            setHostExists(!!activeHost);

            if (isJoinedRef.current && myPlayerIdRef.current) {
                const myData = data[myPlayerIdRef.current];
                if (myData && !myData.isKicked) {
                    setHostLost(!activeHost);
                }
            } else {
                setHostLost(false);
            }
        };

        const handlePresenceAndKick = (data) => {
            if (!isJoinedRef.current || !myPlayerIdRef.current || isJoiningRef.current) return;
            const pid = myPlayerIdRef.current;
            const myData = data[pid];

            if (myData?.isKicked) {
                missingPlayerSinceRef.current = 0;
                onDisconnect(ref(db, `rooms/${selectedGame}/players/${pid}`)).cancel();
                remove(ref(db, `rooms/${selectedGame}/players/${pid}`));
                if (!isLeavingVoluntarily.current) {
                    setLobbyMessage('⚠️ Zostałeś wyrzucony z pokoju przez Hosta.');
                }
                setSelectedGame(null);
                setIsJoined(false);
                setPlayerName('');
                setIsHost(false);
                setMyPlayerId(null);
                setHostExists(false);
                setHostLost(false);
                setNameError('');
                return;
            }

            if (!myData) {
                if (!missingPlayerSinceRef.current) {
                    missingPlayerSinceRef.current = Date.now();
                }
                const missingFor = Date.now() - missingPlayerSinceRef.current;
                const pastJoinGrace = Date.now() > joinGraceUntilRef.current;
                const pastMissingGrace = missingFor >= getPresenceMissingGraceMs();
                if (
                    pastJoinGrace &&
                    pastMissingGrace &&
                    !isLeavingVoluntarily.current
                ) {
                    setLobbyMessage('⚠️ Utracono połączenie z pokojem. Dołącz ponownie.');
                    setSelectedGame(null);
                    setIsJoined(false);
                    setPlayerName('');
                    setIsHost(false);
                    setMyPlayerId(null);
                    setHostExists(false);
                    setHostLost(false);
                    setNameError('');
                }
                return;
            }

            missingPlayerSinceRef.current = 0;

            if (myData.isOnline === false) {
                if (!isOnlineHealSentRef.current) {
                    isOnlineHealSentRef.current = true;
                    set(ref(db, `rooms/${selectedGame}/players/${pid}/isOnline`), true);
                }
            } else {
                isOnlineHealSentRef.current = false;
            }
            setIsHost(myData.isHost || false);
        };

        const playersDebounceMs = getPlayersDebounceMs();

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const unsubscribe = onValue(playersRef, (snapshot) => {
            let data = snapshot.val() || {};

            if (isHostRef.current) {
                const zombieKeys = Object.keys(data).filter((key) => {
                    const p = data[key];
                    if (!p) return false;
                    if (String(p.name || '').trim()) return false;
                    if (p.isOnline === true) return false;
                    return true;
                });
                if (zombieKeys.length > 0) {
                    const updates = {};
                    zombieKeys.forEach((key) => {
                        updates[`rooms/${selectedGame}/players/${key}`] = null;
                    });
                    update(ref(db), updates);
                    data = { ...data };
                    zombieKeys.forEach((k) => {
                        delete data[k];
                    });
                }
            }

            const json = JSON.stringify(data);
            if (json === lastPlayersJson) return;
            lastPlayersJson = json;

            clearTimeout(playersTimeoutId);
            playersTimeoutId = setTimeout(() => {
                handlePresenceAndKick(data);
                applyPlayersSnapshot(data);
            }, playersDebounceMs);
        });

        const lockedRef = ref(db, `rooms/${selectedGame}/isLocked`);
        const unsubscribeLocked = onValue(lockedRef, (snapshot) => {
            setIsRoomLocked(snapshot.val() || false);
        });

        return () => {
            clearTimeout(playersTimeoutId);
            unsubscribe();
            unsubscribeLocked();
        };
    }, [selectedGame, isJoined, myPlayerId, playJoinSound]);

    useEffect(() => {
        if (!isJoined || typeof document === 'undefined') return undefined;
        const onVisibility = () => {
            if (document.hidden) {
                joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [isJoined]);

    const triggerHostMigration = useCallback(async () => {
        if (!selectedGame || !myPlayerId) return;
        const snapshot = await get(ref(db, `rooms/${selectedGame}/players`));
        const data = snapshot.val();
        if (!data) return;

        const hasActiveHostNow = Object.values(data).some((p) => p.isHost && p.isOnline !== false);
        if (hasActiveHostNow) return;

        const onlinePlayerKeys = Object.keys(data)
            .filter((k) => data[k].isOnline !== false)
            .sort();

        if (onlinePlayerKeys[0] === myPlayerId) {
            set(ref(db, `rooms/${selectedGame}/players/${myPlayerId}/isHost`), true);
            Object.keys(data).forEach((k) => {
                if (data[k].isHost && k !== myPlayerId) {
                    set(ref(db, `rooms/${selectedGame}/players/${k}/isHost`), false);
                }
            });
        }
    }, [selectedGame, myPlayerId]);

    // Menu główne: 5 listenerów players — debounce zbiorczy (mniej renderów na Malinie)
    useEffect(() => {
        if (selectedGame) return;

        const pendingRef = { current: {} };
        const flushPresence = debounce(() => {
            const batch = { ...pendingRef.current };
            pendingRef.current = {};
            setPresenceByGame((prev) => ({ ...prev, ...batch }));
        }, PRESENCE_DEBOUNCE_MS);

        const unsubs = gameData.games.map((game) => {
            const gameId = game.id;
            const playersRef = ref(db, `rooms/${gameId}/players`);
            return onValue(playersRef, (snapshot) => {
                pendingRef.current[gameId] = snapshot.val() || {};
                flushPresence();
            });
        });

        return () => {
            flushPresence.cancel();
            unsubs.forEach((u) => u());
            setPresenceByGame({});
        };
    }, [selectedGame]);

    // 4. OBSŁUGA TAJNYCH KOMEND ADMINISTRATORA pod logo
    const handleAdminCommand = useCallback(async () => {
        const rawCmd = adminCommand.trim();
        const cleanedCmd = rawCmd.toUpperCase();

        if (cleanedCmd === '') return;

        await runWithBusy(async () => {
        try {
            if (cleanedCmd === 'CLEAR') {
                if (window.confirm("Reseetujemy całą bazę? Wszyscy zostaną wyrzuceni.")) {
                    gameData.games.forEach(game => {
                        set(ref(db, `rooms/${game.id}/players`), null);
                    });
                    setLobbyMessage('🧹 Konsola: Wyczyszczono wszystkich graczy ze wszystkich pokoi.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            if (cleanedCmd === 'RESET') {
                if (!selectedGame) {
                    alert('❌ Brak wybranego pokoju. Użyj CLEAR aby wyczyścić wszystkie pokoje.');
                    return;
                }
                if (window.confirm("⚠️ Czy na pewno chcesz całkowicie wyczyścić ten pokój? Wszyscy obecni gracze zostaną wyrzuceni!")) {
                    set(ref(db, `rooms/${selectedGame}`), null);
                    setLobbyMessage('🧹 Konsola: Wyczyszczono aktualny pokój.');
                    setAdminCommand('');
                    setShowAdminPanel(false);
                }
                return;
            }

            // ADMIN shortcuts: 'ADMIN' toggles admin mode, or 'ADMIN KICK <name>' to target
            if (cleanedCmd === 'ADMIN') {
                const newState = !isAdminMode;
                setIsAdminMode(newState);
                setLobbyMessage(`🔧 Konsola: Tryb ADMIN ${newState ? 'włączony' : 'wyłączony'}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            if (cleanedCmd.startsWith('ADMIN ')) {
                if (!selectedGame) {
                    alert('❌ Komenda ADMIN wymaga wybranego pokoju.');
                    return;
                }
                const sub = rawCmd.slice(6).trim(); // keep case for names
                if (sub.toUpperCase().startsWith('KICK ')) {
                    const targetName = sub.slice(5).trim();
                    if (!targetName) {
                        alert('❌ Podaj nazwę gracza do wyrzucenia: ADMIN KICK <name>');
                        return;
                    }
                    const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                    const data = snap.val() || {};
                    const targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === targetName.toLowerCase());
                    if (!targetKey) {
                        alert('❌ Nie znaleziono gracza o podanej nazwie w tym pokoju.');
                        return;
                    }
                    const target = data[targetKey];
                    // Admin wyrzuca natychmiast, niezależnie od stanu isOnline
                    await remove(ref(db, `rooms/${selectedGame}/players/${targetKey}`));
                    setLobbyMessage(`🧹 Konsola: Wyrzucono gracza ${target.name || targetKey} z pokoju.`);
                    setAdminCommand('');
                    setShowAdminPanel(false);
                    return;
                }
                alert('❌ Nieznana podkomenda ADMIN. Użyj: ADMIN KICK <name>');
                return;
            }

            // HOST transfer: HOST <name> or HOST ME or simple HOST -> make caller host
            if (cleanedCmd === 'HOST') {
                if (!selectedGame) {
                    alert('❌ Komenda HOST wymaga wybranego pokoju.');
                    return;
                }
                if (!myPlayerId) {
                    alert('❌ Musisz być graczem w pokoju, aby stać się Hosta. Dołącz najpierw.');
                    return;
                }
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};
                if (!data[myPlayerId]) {
                    alert('❌ Twój gracz nie istnieje w tym pokoju.');
                    return;
                }
                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${myPlayerId}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(`🔁 Konsola: Przekazano rolę Hosta do ${data[myPlayerId]?.name || myPlayerId}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            // HOST transfer: HOST <name> or HOST ME
            if (cleanedCmd.startsWith('HOST')) {
                if (!selectedGame) {
                    alert('❌ Komenda HOST wymaga wybranego pokoju.');
                    return;
                }
                const arg = rawCmd.split(/\s+/).slice(1).join(' ').trim();
                if (!arg) {
                    alert('❌ Użycie: HOST <name> lub HOST ME');
                    return;
                }
                const snap = await get(ref(db, `rooms/${selectedGame}/players`));
                const data = snap.val() || {};

                let targetKey = null;
                if (arg.toUpperCase() === 'ME') {
                    if (!myPlayerId) {
                        alert('❌ Nie jesteś graczem w tym pokoju. Wpisz nazwę gracza lub dołącz zanim użyjesz HOST ME.');
                        return;
                    }
                    targetKey = myPlayerId;
                } else {
                    targetKey = Object.keys(data).find(k => String(data[k]?.name || '').toLowerCase() === arg.toLowerCase());
                    if (!targetKey) {
                        alert('❌ Nie znaleziono gracza o podanej nazwie w tym pokoju.');
                        return;
                    }
                }

                const updates = {};
                Object.keys(data).forEach(k => {
                    updates[`rooms/${selectedGame}/players/${k}/isHost`] = false;
                });
                updates[`rooms/${selectedGame}/players/${targetKey}/isHost`] = true;
                await update(ref(db), updates);
                setLobbyMessage(`🔁 Konsola: Przekazano rolę Hosta do ${data[targetKey]?.name || targetKey}.`);
                setAdminCommand('');
                setShowAdminPanel(false);
                return;
            }

            alert('❌ Nieznana komenda administratora.');
        } catch (e) {
            console.error(e);
            alert('❌ Błąd podczas wykonywania komendy. Sprawdź konsolę.');
        }
        });
    }, [adminCommand, selectedGame, myPlayerId, isAdminMode, runWithBusy]);

    // 5. DOŁĄCZANIE DO POKOJU (NADPISYWANIE DUCHÓW / ZABEZPIECZENIEM PRZED BLOKADĄ)
    const handleJoin = async () => {
        isLeavingVoluntarily.current = false; //
        setLobbyMessage('');
        const cleanedName = playerName.trim();
        if (cleanedName === '') {
            setNameError('Podaj imię, aby wejść do pokoju.');
            return;
        }

        await runWithBusy(async () => {
        const lockedSnapshot = await get(ref(db, `rooms/${selectedGame}/isLocked`));
        const isLocked = lockedSnapshot.val() || false;

        const playersRef = ref(db, `rooms/${selectedGame}/players`);
        const snapshot = await get(playersRef);
        const data = snapshot.val() || {};

        const existingPlayerKey = Object.keys(data).find(
            key => data[key].name?.toLowerCase() === cleanedName.toLowerCase()
        );

        if (isLocked && !existingPlayerKey) {
            setNameError('🔒 Ten pokój został zablokowany przez Hosta. Rozgrywka już trwa!');
            return;
        }

        let targetPlayerRef;
        let finalIsHost = isHost;

        if (existingPlayerKey) {
            const existingPlayer = data[existingPlayerKey];

            if (existingPlayer.isKicked) {
                setNameError('Ta nazwa należy do wyrzuconego gracza. Wybierz inną.');
                return;
            }

            if (existingPlayer.isOnline !== false) {
                setNameError(
                    'Ta nazwa jest już zajęta przez aktywnego gracza. Wybierz inną lub poczekaj, aż gracz się rozłączy (💤).'
                );
                return;
            }

            targetPlayerRef = ref(db, `rooms/${selectedGame}/players/${existingPlayerKey}`);
            setMyPlayerId(existingPlayerKey);
            finalIsHost = !!existingPlayer.isHost;
            setIsHost(finalIsHost);
        } else {
            if (isHost) {
                set(ref(db, `rooms/${selectedGame}/gameState`), null);
            }
            const newPlayerRef = push(playersRef);
            targetPlayerRef = newPlayerRef;
            setMyPlayerId(newPlayerRef.key);
        }

        joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
        missingPlayerSinceRef.current = 0;
        isJoiningRef.current = true;

        try {
            await set(targetPlayerRef, {
                name: cleanedName,
                isHost: finalIsHost,
                isOnline: true,
                isKicked: false,
                joinedAt: Date.now(),
            });

            const verify = await get(targetPlayerRef);
            if (!verify.val()?.name) {
                setNameError('Nie udało się zapisać w pokoju. Spróbuj ponownie.');
                return;
            }

            try {
                onDisconnect(targetPlayerRef).update({ isOnline: false });
            } catch (discErr) {
                console.warn('[join] onDisconnect:', discErr);
            }

            setIsJoined(true);
            setNameError('');
            joinGraceUntilRef.current = Date.now() + getJoinGraceMs();
        } catch (err) {
            console.error(err);
            joinGraceUntilRef.current = 0;
            setNameError('Nie udało się dołączyć. Sprawdź połączenie z bazą (na dole ekranu).');
        } finally {
            isJoiningRef.current = false;
        }
        });
    };

    const kickPlayer = useCallback(async (playerId) => {
        if (!selectedGame || !myPlayerId) return;
        await runWithBusy(async () => {
            try {
                const meSnap = await get(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
                if (!meSnap.val()?.isHost) {
                    alert('❌ Tylko aktywny Host może wyrzucać graczy. Odśwież stronę lub użyj HOST ME w konsoli.');
                    return;
                }
                const targetRef = ref(db, `rooms/${selectedGame}/players/${playerId}`);
                const targetSnap = await get(targetRef);
                const target = targetSnap.val();
                if (!target) return;
                if (target.isHost) {
                    alert('❌ Nie możesz wyrzucić Hosta.');
                    return;
                }

                await update(targetRef, { isKicked: true, isOnline: false });

                if (target.isOnline === false) {
                    await remove(targetRef);
                } else {
                    window.setTimeout(async () => {
                        try {
                            const again = await get(targetRef);
                            if (again.val()?.isKicked) await remove(targetRef);
                        } catch {
                            /* backup cleanup */
                        }
                    }, 3000);
                }

                setLobbyMessage(`🧹 Host: Wyrzucono ${target.name || 'gracza'} z pokoju.`);
            } catch (err) {
                console.error(err);
                alert('❌ Błąd przy wyrzucaniu gracza. Sprawdź połączenie z bazą (na dole ekranu).');
            }
        });
    }, [selectedGame, myPlayerId, runWithBusy]);

    const adminKick = useCallback(async (gameId, playerKey) => {
        try {
            const snap = await get(ref(db, `rooms/${gameId}/players/${playerKey}`));
            const p = snap.val();
            if (!p) {
                alert('❌ Nie znaleziono gracza.');
                return;
            }
            // Admin powinien móc usunąć dowolnego gracza natychmiast
            await remove(ref(db, `rooms/${gameId}/players/${playerKey}`));
            setLobbyMessage(`🧹 Konsola: Admin wyrzucił ${p.name || playerKey} z pokoju ${gameId}.`);
        } catch (e) {
            console.error(e);
            alert('❌ Błąd przy wyrzucaniu gracza.');
        }
    }, []);

    const handleBackToMenu = () => {
        isLeavingVoluntarily.current = true; //
        if (myPlayerId) {
            remove(ref(db, `rooms/${selectedGame}/players/${myPlayerId}`));
        }

        setSelectedGame(null);
        setIsJoined(false);
        setPlayerName('');
        setIsHost(false);
        setMyPlayerId(null);
        setHostExists(false);
        setHostLost(false);
        setNameError('');
    };

    return (
        <div className="app-container">
            {/* Logo z obsługą double click (Easter egg panelu admina) */}
            <h1
                onDoubleClick={toggleAdminPanel}
                className="main-logo-clickable"
                title="Przytrzymaj 0,6 s (telefon) lub kliknij dwukrotnie — konsola admina"
                {...logoLongPress}
            >
                Party Games
            </h1>

            <IosWifiHelp />

            {firebaseConnection.mode === 'emulator' && (
                <div className="party-ap-banner" role="alert">
                    {firebaseConnection.onPartyGateway ? (
                        <>
                            Jesteś na <strong>{PI_AP_GATEWAY}</strong> — dobrze. Goście: Wi‑Fi{' '}
                            <strong>PartBox-Gry</strong>, ten sam adres w przeglądarce.
                        </>
                    ) : (
                        <>
                            Impreza: Wi‑Fi <strong>PartBox-Gry</strong> i{' '}
                            <a href={`http://${PI_AP_GATEWAY}`}>http://{PI_AP_GATEWAY}</a> u wszystkich
                            (nie mieszaj z IP w LAN).
                        </>
                    )}
                </div>
            )}

            <button
                type="button"
                className="settings-trigger"
                onClick={() => setShowSettings((prev) => !prev)}
                aria-label="Otwórz ustawienia"
            >
                ⚙
            </button>

            {showSettings && (
                <div className="settings-panel" role="dialog" aria-label="Ustawienia aplikacji">
                    <div className="settings-panel__header">
                        <h2>Ustawienia</h2>
                        <button
                            type="button"
                            className="settings-close"
                            onClick={() => setShowSettings(false)}
                            aria-label="Zamknij ustawienia"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <div className="settings-panel__label">Gradient tła</div>
                        <div className="settings-presets">
                            {themePresets.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`settings-preset ${themePreset === preset.id ? 'active' : ''}`}
                                    onClick={() => setThemePreset(preset.id)}
                                    aria-label={preset.label}
                                    aria-pressed={themePreset === preset.id}
                                    style={{
                                        backgroundImage: `linear-gradient(135deg, ${preset.stops[0]} 0%, ${preset.stops[1]} 50%, ${preset.stops[2]} 100%)`
                                    }}
                                >
                                    <span className="sr-only">{preset.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => setSoundEnabled((prev) => !prev)}
                            aria-pressed={soundEnabled}
                        >
                            <span>Dźwięk aplikacji</span>
                            <span className={`settings-toggle__icon ${soundEnabled ? 'on' : 'off'}`}>
                                {soundEnabled ? '✔' : '✕'}
                            </span>
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => setVibrationEnabled((prev) => !prev)}
                            aria-pressed={vibrationEnabled}
                        >
                            <span>Wibracje</span>
                            <span className={`settings-toggle__icon ${vibrationEnabled ? 'on' : 'off'}`}>
                                {vibrationEnabled ? '✔' : '✕'}
                            </span>
                        </button>
                    </div>

                    <div className="settings-panel__group">
                        <button
                            type="button"
                            className="settings-toggle"
                            onClick={() => {
                                toggleAdminPanel();
                                setShowSettings(false);
                            }}
                            aria-pressed={showAdminPanel}
                        >
                            <span>Konsola administratora</span>
                            <span className={`settings-toggle__icon ${showAdminPanel ? 'on' : 'off'}`}>
                                {showAdminPanel ? '✔' : '✕'}
                            </span>
                        </button>
                        <p className="settings-hint settings-hint--tight">
                            Komendy: CLEAR, RESET, ADMIN… Albo przytrzymaj logo „Party Games” ~0,6 s.
                        </p>
                    </div>

                    <p className="settings-hint">
                        {isLowPowerDevice()
                            ? 'Malinka: tryb oszczędny. Na iPhonie wyłącz prywatny adres Wi‑Fi dla PartBox-Gry.'
                            : 'Internet: pełne animacje i efekty.'}
                    </p>
                </div>
            )}

            {lobbyMessage && <p className="error-message">{lobbyMessage}</p>}

            {/* PANEL DEWELOPERSKI */}
            {showAdminPanel && (
                <div className="admin-panel-container">
                    <input
                        type="text"
                        value={adminCommand}
                        onChange={(e) => setAdminCommand(e.target.value)}
                        placeholder="Konsola:"
                        onKeyDown={(e) => e.key === 'Enter' && handleAdminCommand()}
                        className="input-admin-console"
                    />
                </div>
            )}

            {!selectedGame ? (
                <div>
                    <p>Wybierz pokój gry, do którego chcesz dołączyć:</p>
                    <div className="games-grid">
                        {gameData.games.map((game) => (
                            <button key={game.id} onClick={() => {
                                setSelectedGame(game.id);
                                setLobbyMessage('');
                                setShowAdminPanel(false);
                            }}>
                                <span className="game-title">{game.name}</span>
                                <span className="game-desc">{game.description}</span>
                            </button>
                        ))}
                    </div>

                    {/* LISTA GRACZY ONLINE W GŁÓWNYM MENU */}
                    <div className="players-section">
                        <h3>Wszyscy gracze online:</h3>
                        <div className="players-list">
                            <GlobalPlayersList
                                players={globalPlayersList}
                                isAdminMode={isAdminMode}
                                onAdminKick={adminKick}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div>
                    {!isJoined ? (
                        <div>
                            <h2>Pokój: {currentGameMeta?.name}</h2>
                            <p>Wpisz swoje imię, aby wejść:</p>
                            <input
                                type="text"
                                value={playerName}
                                onChange={(e) => {
                                    setPlayerName(e.target.value);
                                    setNameError('');
                                }}
                                placeholder="Twoje imię..."
                                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                                className={nameError ? 'input-error' : ''}
                                required
                                aria-invalid={nameError ? 'true' : 'false'}
                            />

                            {nameError && <p className="error-message">{nameError}</p>}

                            {hostExists ? (
                                <div className="host-status-container">
                                    <button type="button" className="host-status-card disabled" disabled>
                                        <span className="host-status-card__content">
                                            <strong>Pokój ma już aktywnego Hosta</strong>
                                            <span>Dołączasz jako gracz.</span>
                                        </span>
                                        <span className="host-status-card__icon">🔒</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="host-checkbox-container">
                                    <button
                                        type="button"
                                        className={`host-toggle ${isHost ? 'on' : 'off'}`}
                                        onClick={() => setIsHost((prev) => !prev)}
                                        aria-pressed={isHost}
                                    >
                                        <span>Jestem Hostem (Dowodzę stołem)</span>
                                        <span className={`host-toggle__icon ${isHost ? 'on' : 'off'}`}>
                                            {isHost ? '✔' : '✕'}
                                        </span>
                                    </button>
                                </div>
                            )}

                            <div className="actions-stack">
                                <button onClick={handleJoin} disabled={playerName.trim() === ''}>Wejdź do pokoju</button>
                                <button onClick={handleBackToMenu} className="btn-link">Wróć do wyboru gier</button>
                            </div>

                            
                        </div>
                    ) : (
                        <div>
                            <h2>Grasz w: {currentGameMeta?.name}</h2>

                            {effectiveIsHost && (
                                <div className="room-lock-container">
                                    <button
                                        onClick={() => set(ref(db, `rooms/${selectedGame}/isLocked`), !isRoomLocked)}
                                        className={`btn-lock-toggle ${isRoomLocked ? 'locked' : 'unlocked'}`}
                                    >
                                        {isRoomLocked ? '🔒 Pokój zablokowany (Kliknij by zmienić)' : '🔓 Pokój odblokowany (Kliknij by zmienić)'}
                                    </button>
                                </div>
                            )}

                            <MigrationBanner
                                hostLost={hostLost}
                                myPlayerId={myPlayerId}
                                isJoined={isJoined}
                                selectedGame={selectedGame}
                                onMigrate={triggerHostMigration}
                            />

                            <Suspense fallback={<p className="game-loading">Ładowanie gry…</p>}>
                                {selectedGame === 'never-have-i-ever' && (
                                    <NeverHaveIEver isHost={effectiveIsHost} onLeave={handleBackToMenu} roomInviteUrl={roomInviteUrl} />
                                )}

                                {selectedGame === 'truth-or-dare' && (
                                    <TruthOrDare
                                        isHost={effectiveIsHost}
                                        onLeave={handleBackToMenu}
                                        playerName={playerName}
                                        roomInviteUrl={roomInviteUrl}
                                        vibrationEnabled={vibrationEnabled}
                                    />
                                )}

                                {selectedGame === 'impostor' && (
                                    <Impostor
                                        isHost={effectiveIsHost}
                                        onLeave={handleBackToMenu}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        roomInviteUrl={roomInviteUrl}
                                    />
                                )}

                                {selectedGame === 'mafia' && (
                                    <Mafia
                                        isHost={effectiveIsHost}
                                        onLeave={handleBackToMenu}
                                        myPlayerId={myPlayerId}
                                        tablePlayers={playersList}
                                        roomInviteUrl={roomInviteUrl}
                                    />
                                )}

                                {selectedGame === 'dark-stories' && (
                                    <DarkStories isHost={effectiveIsHost} onLeave={handleBackToMenu} roomInviteUrl={roomInviteUrl} />
                                )}
                            </Suspense>
                        </div>
                    )}

                    {/* SEKCJA LISTY GRACZY W POKOJU */}
                    <div className="players-section">
                        <h3>Gracze przy stole:</h3>
                        <div className="players-list">
                            {playersList.length > 0 ? playersList.map(p => (
                                <span key={p.id} className={`player-tag ${p.isOnline === false ? 'player-offline' : ''}`}>
                                    {p.name} {p.isOnline === false && '💤'}

                                    {(isJoined && effectiveIsHost && p.id !== myPlayerId) && (
                                        <button
                                            type="button"
                                            onClick={() => kickPlayer(p.id)}
                                            className="btn-kick"
                                            title={`Wyrzuć gracza ${p.name}`}
                                        >
                                            ✕
                                        </button>
                                    )}

                                    {isAdminMode && p.id && (
                                        <button
                                            onClick={() => adminKick(selectedGame, p.id)}
                                            className="btn-admin-kick"
                                            title="Admin: wyrzuć gracza"
                                        >
                                            🛑
                                        </button>
                                    )}
                                </span>
                            )) : <span className="empty-room-text">Pusty pokój...</span>}
                        </div>
                    </div>
                </div>
            )}

            <ConnectionStatus />
        </div>
    );
}

export default App;