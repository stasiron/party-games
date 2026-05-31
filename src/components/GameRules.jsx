import { useState, useCallback } from 'react';
import { useLocale } from '../locales/LocaleContext';

function GameRules({ title, children, defaultOpen = false }) {
    const { t } = useLocale();
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const toggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const titleSuffix = title ? t('gameRules.suffix', { title }) : '';

    return (
        <div className="game-rules">
            <button
                type="button"
                className="btn-rules-toggle"
                onClick={toggle}
                aria-expanded={isOpen}
            >
                {isOpen ? t('gameRules.toggleHide') : t('gameRules.toggleShow')}
                {titleSuffix}
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
