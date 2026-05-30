import { useState, useCallback, lazy, Suspense } from 'react';

const QRCodeSVG = lazy(() =>
    import('qrcode.react').then((m) => ({ default: m.QRCodeSVG }))
);

function RoomInviteQR({
    inviteUrl,
    roomId = '',
    showCodeInList,
    onToggleShowCodeInList,
    className = '',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);

    const handleCopyLink = useCallback(async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
        } catch {
            alert('Nie udało się skopiować linku. Spróbuj ręcznie z paska adresu (parametr room=...).');
        }
    }, [inviteUrl]);

    const handleCopyCode = useCallback(async () => {
        if (!roomId) return;
        try {
            await navigator.clipboard.writeText(roomId);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        } catch {
            alert(`Nie udało się skopiować kodu. Kod pokoju: ${roomId}`);
        }
    }, [roomId]);

    if (!inviteUrl && !roomId) return null;

    const canToggleList = typeof onToggleShowCodeInList === 'function';

    return (
        <div className={`room-invite ${className}`.trim()}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="btn-invite-toggle"
                aria-expanded={isOpen}
            >
                {isOpen ? 'Ukryj opcje udostępniania' : 'Opcje udostępniania'}
            </button>

            {isOpen && (
                <div className="room-invite__panel">
                    {roomId && (
                        <div className="room-invite__section">
                            <p className="room-invite__section-title">Kod pokoju</p>
                            <div className="room-invite__code-row">
                                <span className="room-invite__code">{roomId}</span>
                                <button
                                    type="button"
                                    onClick={handleCopyCode}
                                    className="room-invite__mini-btn"
                                >
                                    {copiedCode ? 'Skopiowano!' : 'Kopiuj kod'}
                                </button>
                            </div>
                            {canToggleList && (
                                <button
                                    type="button"
                                    onClick={onToggleShowCodeInList}
                                    className={`room-invite__mini-btn room-invite__mini-btn--toggle ${showCodeInList ? 'is-on' : ''}`}
                                    aria-pressed={showCodeInList}
                                >
                                    {showCodeInList
                                        ? '👁 Kod widoczny na liście gości'
                                        : '👁 Kod ukryty na liście gości'}
                                </button>
                            )}
                        </div>
                    )}

                    {inviteUrl && (
                        <div className="room-invite__section">
                            <p className="room-invite__section-title">Link i kod QR</p>
                            <p className="room-invite__hint">
                                Zeskanuj telefonem — otworzy się ta sama gra i pokój. Gracz wpisze tylko imię i dołączy.
                            </p>
                            <div className="room-invite__qr" aria-hidden="true">
                                <Suspense fallback={<div className="room-invite__qr-placeholder" aria-hidden="true" />}>
                                    <QRCodeSVG value={inviteUrl} size={200} level="M" includeMargin />
                                </Suspense>
                            </div>
                            <button type="button" onClick={handleCopyLink} className="btn-copy-invite">
                                {copiedLink ? 'Skopiowano link!' : 'Kopiuj link do pokoju'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function HostShareOptions({ shareOptions, className = 'room-invite--slot' }) {
    if (!shareOptions) return null;
    return (
        <RoomInviteQR
            inviteUrl={shareOptions.inviteUrl}
            roomId={shareOptions.roomId}
            showCodeInList={shareOptions.showCodeInList}
            onToggleShowCodeInList={shareOptions.onToggleShowCodeInList}
            className={className}
        />
    );
}

export default RoomInviteQR;
