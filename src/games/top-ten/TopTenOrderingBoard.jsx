import { useMemo } from 'react';
import { getTablePlayers } from '../../lib/guestPlayers';

function TopTenOrderingBoard({
    playerOrder,
    tablePlayers,
    interactionKind = 'individual',
    canEdit,
    currentTurnPlayerId,
    onMoveUp,
    onMoveDown,
    pickMoveIndex,
    onPickMovePlayer,
    swapSelection = [],
    swapTargetIndices = [],
    onSelectForSwap,
}) {
    const nameById = useMemo(() => {
        const map = new Map();
        getTablePlayers(tablePlayers).forEach((p) => map.set(p.id, p.name));
        return map;
    }, [tablePlayers]);

    if (!Array.isArray(playerOrder) || playerOrder.length === 0) {
        return <p className="top-ten-ordering-hint">Brak graczy do ułożenia.</p>;
    }

    const isPickMove = interactionKind === 'turn-pick-move';
    const isSwapAny = interactionKind === 'turn-swap';
    const isPickTarget = interactionKind === 'turn-pick-target';
    const isTurnStep = interactionKind === 'turn-step';
    const isIndividualMove = interactionKind === 'individual';
    const showMoveArrows = canEdit && (isTurnStep || isPickMove || isIndividualMove);

    return (
        <div className="top-ten-ordering">
            <p className="top-ten-ordering-scale top-ten-ordering-scale--high">10 — najwyżej</p>
            <ol className="top-ten-ordering-list">
                {playerOrder.map((playerId, index) => {
                    const isSelected = swapSelection.includes(index);
                    const isPickSelected = pickMoveIndex === index;
                    const isTurnPlayer = currentTurnPlayerId && playerId === currentTurnPlayerId;
                    const isTarget = swapTargetIndices.includes(index);
                    const rowClass = [
                        'top-ten-ordering-row',
                        isTurnPlayer ? 'top-ten-ordering-row--turn' : '',
                        isTarget ? 'top-ten-ordering-row--target' : '',
                        (isSwapAny || isPickTarget) && isSelected ? 'top-ten-ordering-row--selected' : '',
                        isPickMove && isPickSelected ? 'top-ten-ordering-row--selected' : '',
                    ].filter(Boolean).join(' ');

                    const nameClickable = canEdit && (isPickMove || isSwapAny || isPickTarget);
                    const showRowArrows = showMoveArrows && (!isPickMove || isPickSelected);

                    return (
                        <li key={playerId} className={rowClass}>
                            <span className="top-ten-ordering-rank">{playerOrder.length - index}</span>
                            {nameClickable ? (
                                <button
                                    type="button"
                                    className="top-ten-ordering-name top-ten-ordering-name--pick"
                                    onClick={() => {
                                        if (isPickMove) onPickMovePlayer(index);
                                        else onSelectForSwap(index);
                                    }}
                                >
                                    {nameById.get(playerId) ?? 'Nieznany gracz'}
                                </button>
                            ) : (
                                <span className="top-ten-ordering-name">
                                    {nameById.get(playerId) ?? 'Nieznany gracz'}
                                </span>
                            )}
                            {showRowArrows && (
                                <span className="top-ten-ordering-actions">
                                    <button
                                        type="button"
                                        className="top-ten-ordering-btn"
                                        onClick={() => onMoveUp(index)}
                                        disabled={index === 0}
                                        aria-label="Wyżej (bliżej 10)"
                                    >
                                        ▲
                                    </button>
                                    <button
                                        type="button"
                                        className="top-ten-ordering-btn"
                                        onClick={() => onMoveDown(index)}
                                        disabled={index === playerOrder.length - 1}
                                        aria-label="Niżej (bliżej 1)"
                                    >
                                        ▼
                                    </button>
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            <p className="top-ten-ordering-scale top-ten-ordering-scale--low">1 — najniżej</p>
        </div>
    );
}

export default TopTenOrderingBoard;
