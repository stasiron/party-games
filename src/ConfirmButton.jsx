import { useState, useEffect } from 'react';

export default function ConfirmButton({ onClick, text, confirmText = "Na pewno? Kliknij znów", style }) {
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
            style={{
                backgroundColor: isConfirming ? '#ff4444' : 'transparent',
                color: isConfirming ? '#fff' : 'rgba(255, 255, 255, 0.4)',
                border: isConfirming ? '1px solid #ff4444' : '1px solid rgba(255, 255, 255, 0.2)',
                padding: '8px 16px',
                fontSize: '0.8rem',
                borderRadius: '20px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                margin: '5px',
                fontWeight: isConfirming ? 'bold' : 'normal',
                ...style
            }}
        >
            {isConfirming ? confirmText : text}
        </button>
    );
}