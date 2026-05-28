import { useState, useCallback, useEffect } from 'react';

/**
 * Dwuetapowy podgląd roli na współdzielonym telefonie:
 * 1) właściciel — przytrzymaj, potem potwierdź (przycisk zostaje po puszczeniu);
 * 2) gość(e) — kolejno na tym samym urządzeniu.
 */
function SharedPhoneRoleReveal({
    guests,
    resetEpoch = 0,
    skipOwnerStep = false,
    ownerPeekClassName = '',
    peekHiddenClassName = 'impostor-bg-hidden',
    peekPanelExtraClass = '',
    renderOwnerReveal,
    renderGuestReveal,
    secretWarning = 'Ukryj ekran przed innymi!',
    onAllGuestsDone,
}) {
    const [showRole, setShowRole] = useState(false);
    const [ownerConfirmed, setOwnerConfirmed] = useState(skipOwnerStep);
    const [guestIndex, setGuestIndex] = useState(0);
    const [showGuestRole, setShowGuestRole] = useState(false);
    const [ownerUnlocked, setOwnerUnlocked] = useState(false);
    const [guestUnlocked, setGuestUnlocked] = useState(false);
    const [allDone, setAllDone] = useState(false);

    const resetFlow = useCallback(() => {
        setShowRole(false);
        setOwnerConfirmed(skipOwnerStep);
        setGuestIndex(0);
        setShowGuestRole(false);
        setOwnerUnlocked(false);
        setGuestUnlocked(false);
        setAllDone(false);
    }, [skipOwnerStep]);

    useEffect(() => {
        resetFlow();
    }, [resetEpoch, resetFlow]);

    useEffect(() => {
        if (showRole) setOwnerUnlocked(true);
    }, [showRole]);

    useEffect(() => {
        if (showGuestRole) setGuestUnlocked(true);
    }, [showGuestRole]);

    useEffect(() => {
        setGuestUnlocked(false);
        setShowGuestRole(false);
    }, [guestIndex]);

    const currentGuest = guests[guestIndex] ?? null;
    const hasMoreGuests = guestIndex < guests.length - 1;

    const confirmOwner = useCallback(() => {
        setShowRole(false);
        setOwnerConfirmed(true);
        setGuestIndex(0);
        setShowGuestRole(false);
        setGuestUnlocked(false);
        if (guests.length === 0) {
            setAllDone(true);
            onAllGuestsDone?.();
        }
    }, [guests.length, onAllGuestsDone]);

    const confirmGuest = useCallback(() => {
        setShowGuestRole(false);
        if (hasMoreGuests) {
            setGuestIndex((i) => i + 1);
        } else {
            setAllDone(true);
            onAllGuestsDone?.();
        }
    }, [hasMoreGuests, onAllGuestsDone]);

    if (allDone) {
        return (
            <p className="shared-phone-reveal__done">
                Wszyscy przy tym telefonie znają swoje role. Możesz ponowić podgląd, jeśli pokój jest
                odblokowany.
            </p>
        );
    }

    if (!ownerConfirmed) {
        return (
            <div className="shared-phone-reveal">
                <p className="shared-phone-reveal__step">Krok 1 — Twoja rola (właściciel telefonu)</p>
                <div
                    onMouseDown={() => setShowRole(true)}
                    onMouseUp={() => setShowRole(false)}
                    onMouseLeave={() => setShowRole(false)}
                    onTouchStart={() => setShowRole(true)}
                    onTouchEnd={() => setShowRole(false)}
                    className={`peek-panel ${peekPanelExtraClass} ${showRole ? ownerPeekClassName : peekHiddenClassName}`}
                >
                    {!showRole ? (
                        <h3 className="peek-hidden-text">Kliknij i przytrzymaj, aby zobaczyć swoją rolę</h3>
                    ) : (
                        renderOwnerReveal()
                    )}
                </div>
                <div className="shared-phone-reveal__actions">
                    {ownerUnlocked && (
                        <button
                            type="button"
                            className="btn-accent shared-phone-reveal__confirm"
                            onClick={confirmOwner}
                        >
                            {guests.length > 0
                                ? 'Potwierdzam — przekaż telefon gościowi'
                                : 'Potwierdzam — ukryj ekran'}
                        </button>
                    )}
                    {!ownerUnlocked && (
                        <p className="shared-phone-reveal__hint">Przytrzymaj panel powyżej, aby odblokować przycisk.</p>
                    )}
                </div>
                <p className="impostor-secret-warning">{secretWarning}</p>
            </div>
        );
    }

    if (!currentGuest) {
        return (
            <p className="shared-phone-reveal__done">Wszyscy przy tym telefonie znają swoje role.</p>
        );
    }

    return (
        <div className="shared-phone-reveal">
            <p className="shared-phone-reveal__step">
                {skipOwnerStep ? 'Rola gościa' : 'Krok 2 — rola gościa'}: <strong>{currentGuest.name}</strong>
                {guests.length > 1 && ` (${guestIndex + 1}/${guests.length})`}
            </p>
            <div
                onMouseDown={() => setShowGuestRole(true)}
                onMouseUp={() => setShowGuestRole(false)}
                onMouseLeave={() => setShowGuestRole(false)}
                onTouchStart={() => setShowGuestRole(true)}
                onTouchEnd={() => setShowGuestRole(false)}
                className={`peek-panel ${peekPanelExtraClass} ${showGuestRole ? ownerPeekClassName : peekHiddenClassName}`}
            >
                {!showGuestRole ? (
                    <h3 className="peek-hidden-text">
                        {currentGuest.name}: przytrzymaj, aby zobaczyć rolę
                    </h3>
                ) : (
                    renderGuestReveal(currentGuest)
                )}
            </div>
            <div className="shared-phone-reveal__actions">
                {guestUnlocked && (
                    <button
                        type="button"
                        className="btn-accent shared-phone-reveal__confirm"
                        onClick={confirmGuest}
                    >
                        {hasMoreGuests ? 'Następny gość przy tym telefonie' : 'Gotowe — ukryj ekran'}
                    </button>
                )}
                {!guestUnlocked && (
                    <p className="shared-phone-reveal__hint">Przytrzymaj panel powyżej, aby odblokować przycisk.</p>
                )}
            </div>
            <p className="impostor-secret-warning">{secretWarning}</p>
        </div>
    );
}

export default SharedPhoneRoleReveal;
