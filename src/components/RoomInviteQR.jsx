import { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';

function RoomInviteQR({ inviteUrl }) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            alert('Nie udało się skopiować linku. Spróbuj ręcznie z paska adresu (parametr game=...).');
        }
    }, [inviteUrl]);

    if (!inviteUrl) return null;

    return (
        <div className="room-invite">
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="btn-invite-toggle"
                aria-expanded={isOpen}
            >
                {isOpen ? 'Ukryj kod QR' : 'Zaproś graczy — pokaż kod QR'}
            </button>

            {isOpen && (
                <div className="room-invite__panel">
                    <p className="room-invite__hint">
                        Zeskanuj telefonem — otworzy się ta sama gra i pokój. Gracz wpisze tylko imię i dołączy.
                    </p>
                    <div className="room-invite__qr" aria-hidden="true">
                        <QRCodeSVG value={inviteUrl} size={200} level="M" includeMargin />
                    </div>
                    <button type="button" onClick={handleCopy} className="btn-copy-invite">
                        {copied ? 'Skopiowano link!' : 'Kopiuj link do pokoju'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default RoomInviteQR;
