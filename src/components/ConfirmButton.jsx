import { useState, useEffect, useCallback, memo } from 'react';

const ConfirmButton = memo(({ onClick, text, confirmText = "Na pewno? Kliknij znów", style, className = "" }) => {
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        if (!isConfirming) return undefined;
        const timer = setTimeout(() => setIsConfirming(false), 3000);
        return () => clearTimeout(timer);
    }, [isConfirming]);

    const handleClick = useCallback(() => {
        if (!isConfirming) {
            setIsConfirming(true);
        } else {
            onClick();
            setIsConfirming(false);
        }
    }, [isConfirming, onClick]);

    return (
        <button
            onClick={handleClick}
            className={`btn-confirm-base ${isConfirming ? 'btn-confirm-active' : 'btn-confirm-idle'} ${className}`}
            style={style}
        >
            {isConfirming ? confirmText : text}
        </button>
    );
});

ConfirmButton.displayName = 'ConfirmButton';
export default ConfirmButton;