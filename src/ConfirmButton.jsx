import { useState, useEffect, memo } from 'react';

// Używamy React.memo, aby zapobiec niepotrzebnemu odrysowywaniu komponentu i oszczędzać CPU/baterię
const ConfirmButton = memo(({ onClick, text, confirmText = "Na pewno? Kliknij znów", style, className = "" }) => {
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        let timer;
        if (isConfirming) {
            // Automatyczny powrót do bezpiecznego stanu po 3 sekundach
            timer = setTimeout(() => setIsConfirming(false), 3000);
        }
        return () => clearTimeout(timer);
    }, [isConfirming]);

    const handleClick = () => {
        if (!isConfirming) {
            setIsConfirming(true); // Pierwsze kliknięcie
        } else {
            onClick(); // Drugie kliknięcie (wykonanie akcji)
            setIsConfirming(false);
        }
    };

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