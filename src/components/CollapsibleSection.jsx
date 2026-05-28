import { useState, useCallback } from 'react';

function CollapsibleSection({
    toggleLabel,
    toggleLabelOpen,
    children,
    defaultOpen = false,
    className = '',
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const toggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const closedLabel = toggleLabel ?? 'Pokaż';
    const openLabel = toggleLabelOpen ?? closedLabel.replace(/^▼\s*/, '▲ ').replace(/Pokaż/, 'Ukryj');

    return (
        <div className={`collapsible-section ${className}`.trim()}>
            <button
                type="button"
                className="btn-collapsible-toggle"
                onClick={toggle}
                aria-expanded={isOpen}
            >
                {isOpen ? openLabel : closedLabel}
            </button>
            {isOpen && <div className="collapsible-section__body">{children}</div>}
        </div>
    );
}

export default CollapsibleSection;
