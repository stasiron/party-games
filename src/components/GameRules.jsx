import { useState, useCallback } from 'react';

function GameRules({ title = 'Zasady gry', children, defaultOpen = false }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const toggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    return (
        <div className="game-rules">
            <button
                type="button"
                className="btn-rules-toggle"
                onClick={toggle}
                aria-expanded={isOpen}
            >
                {isOpen ? '▲ Ukryj zasady' : '▼ Zasady gry'}
                {title !== 'Zasady gry' ? ` — ${title}` : ''}
            </button>
            {isOpen && (
                <div className="game-rules__panel content-panel content-panel--dark">
                    {children}
                </div>
            )}
        </div>
    );
}

export default GameRules;
