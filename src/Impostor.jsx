import { useState, useEffect, useCallback, useMemo } from 'react';
import { ref, set, get, onValue } from 'firebase/database';
import { db } from './firebase';
import gameData from './gameContent.json';
import { getImpostorCategories, getCategoryLabel } from './gameContentUtils';
import ConfirmButton from './ConfirmButton';
import RoomInviteQR from './RoomInviteQR';

function Impostor({ isHost, onLeave, myPlayerId, roomInviteUrl }) {
    const playableCategories = useMemo(
        () => getImpostorCategories(gameData.impostor),
        []
    );

    const [selectedCategories, setSelectedCategories] = useState([]);
    const [showRole, setShowRole] = useState(false);

    const [roomData, setRoomData] = useState({
        phase: 'lobby', // Fazy: 'lobby', 'peeking', 'discussing'
        word: '',
        impostorId: null,
        categoryName: ''
    });

    useEffect(() => {
        const roomRef = ref(db, 'rooms/impostor/gameState');
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setRoomData(data);
            } else {
                setRoomData({ phase: 'lobby', word: '', impostorId: null, categoryName: '' });
            }
        });
        return () => unsubscribe();
    }, []);

    // OPTYMALIZACJA: Cachowanie funkcji wyboru kategorii
    const toggleCategory = useCallback((catId) => {
        setSelectedCategories((prev) =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    }, []);

    const startGame = useCallback(async () => {
        if (selectedCategories.length === 0) return;

        const playersRef = ref(db, 'rooms/impostor/players');
        const snapshot = await get(playersRef);
        const playersData = snapshot.val();

        if (!playersData) return;

        const playerIds = Object.keys(playersData);
        const randomImpostorIndex = Math.floor(Math.random() * playerIds.length);
        const chosenImpostorId = playerIds[randomImpostorIndex];

        // ZMIANA: Łączenie słów ze wszystkich wybranych kategorii
        let combinedWords = [];
        let combinedCatNames = [];

        selectedCategories.forEach(catId => {
            const wordsForCat = gameData.impostor.words[catId];
            if (wordsForCat) {
                combinedWords = [...combinedWords, ...wordsForCat];
            }
            combinedCatNames.push(getCategoryLabel(playableCategories, catId));
        });

        const randomWord = combinedWords[Math.floor(Math.random() * combinedWords.length)];
        const catNameDisplay = combinedCatNames.join(' + ');

        set(ref(db, 'rooms/impostor/gameState'), {
            phase: 'peeking',
            word: randomWord,
            impostorId: chosenImpostorId,
            categoryName: catNameDisplay
        });
    }, [selectedCategories, playableCategories]);

    const startDiscussion = useCallback(() => {
        set(ref(db, 'rooms/impostor/gameState/phase'), 'discussing');
        setShowRole(false);
    }, []);

    const forceResetTable = useCallback(() => {
        set(ref(db, 'rooms/impostor/gameState'), {
            phase: 'lobby',
            word: '',
            impostorId: null,
            categoryName: ''
        });
        setSelectedCategories([]);
        setShowRole(false);
    }, []);

    const handleEndGame = useCallback(() => {
        forceResetTable();
        onLeave();
    }, [forceResetTable, onLeave]);

    const amIImpostor = roomData.impostorId === myPlayerId;

    return (
        <div>
            {roomData.phase === 'lobby' ? (
                <div>
                    {isHost ? (
                        <>
                            <p>Wybierz kategorie dla tej rundy (możesz kilka):</p>
                            <div className="games-grid categories-grid">
                                {playableCategories.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id)}
                                            className={isSelected ? 'category-btn-selected' : 'category-btn-unselected'}
                                        >
                                            <span className="game-title">{cat.name}</span>
                                            <span className="game-desc">{cat.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedCategories.length > 0 && (
                                <button onClick={startGame} className="btn-accent">
                                    Wylosuj z {selectedCategories.length} kategorii i rozdaj role
                                </button>
                            )}
                            <RoomInviteQR inviteUrl={roomInviteUrl} />
                        </>
                    ) : (
                        <p>Czekamy aż Host wybierze kategorie i wylosuje role...</p>
                    )}
                </div>
            ) : (
                <div>
                    {roomData.phase === 'peeking' && (
                        <>
                            <p className="impostor-peeking-header">
                                Faza sprawdzania ról
                            </p>
                            <div
                                onMouseDown={() => setShowRole(true)}
                                onMouseUp={() => setShowRole(false)}
                                onMouseLeave={() => setShowRole(false)}
                                onTouchStart={() => setShowRole(true)}
                                onTouchEnd={() => setShowRole(false)}
                                className={`peek-panel ${showRole ? (amIImpostor ? 'impostor-bg-bad' : 'impostor-bg-good') : 'impostor-bg-hidden'}`}
                            >
                                {!showRole ? (
                                    <h3 className="peek-hidden-text">Kliknij i przytrzymaj, aby zobaczyć rolę</h3>
                                ) : (
                                    <>
                                        <h2 className={`impostor-role-title ${amIImpostor ? 'text-danger' : 'text-success'}`}>
                                            {amIImpostor ? "JESTEŚ OSZUSTEM!" : roomData.word}
                                        </h2>
                                        {amIImpostor && (
                                            <p className="impostor-cat-info">
                                                Kategoria: <span className="text-gold">{roomData.categoryName}</span>
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                            <p className="impostor-secret-warning">Ukryj ekran przed innymi!</p>
                        </>
                    )}

                    {roomData.phase === 'discussing' && (
                        <div className="impostor-discussing-box">
                            <h2 className="impostor-discussing-title">Trwa dyskusja!</h2>
                            <p className="impostor-discussing-desc">Ekrany zostały zablokowane. Czas znaleźć oszusta.</p>
                        </div>
                    )}

                    {isHost && (
                        <div className="game-host-controls">
                            {roomData.phase === 'peeking' && (
                                <button onClick={startDiscussion} className="btn-impostor-discuss">
                                    Rozpocznij dyskusję (Zablokuj podgląd)
                                </button>
                            )}
                            <ConfirmButton onClick={forceResetTable} text="Zakończ rundę i wybierz nową" />
                        </div>
                    )}
                </div>
            )}

            <div className="bottom-controls">
                <ConfirmButton
                    onClick={isHost ? handleEndGame : onLeave}
                    text={isHost ? "Zamknij pokój" : "Wyjdź z pokoju"}
                />
            </div>
        </div>
    );
}

export default Impostor;