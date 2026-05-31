import { useState, useCallback, useEffect } from 'react';
import { useLocale } from '../locales/LocaleContext';

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
    secretWarning,
    onAllGuestsDone,
}) {
    const { t } = useLocale();
    const warningText = secretWarning ?? t('sharedPhone.secretWarning');
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
        const timeoutId = window.setTimeout(() => {
            resetFlow();
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [resetEpoch, resetFlow]);

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
        setGuestUnlocked(false);
        if (hasMoreGuests) {
            setGuestIndex((i) => i + 1);
        } else {
            setAllDone(true);
            onAllGuestsDone?.();
        }
    }, [hasMoreGuests, onAllGuestsDone]);

    if (allDone) {
        return (
            <div className="shared-phone-reveal shared-phone-reveal--done">
                <p className="shared-phone-reveal__done">{t('sharedPhone.allDone')}</p>
                <button
                    type="button"
                    className="btn-accent shared-phone-reveal__confirm"
                    onClick={resetFlow}
                >
                    {t('sharedPhone.passToNextPerson')}
                </button>
            </div>
        );
    }

    if (!ownerConfirmed) {
        return (
            <div className="shared-phone-reveal">
                <p className="shared-phone-reveal__step">{t('sharedPhone.stepOwner')}</p>
                <div
                    onMouseDown={() => {
                        setShowRole(true);
                        setOwnerUnlocked(true);
                    }}
                    onMouseUp={() => setShowRole(false)}
                    onMouseLeave={() => setShowRole(false)}
                    onTouchStart={() => {
                        setShowRole(true);
                        setOwnerUnlocked(true);
                    }}
                    onTouchEnd={() => setShowRole(false)}
                    className={`peek-panel ${peekPanelExtraClass} ${showRole ? ownerPeekClassName : peekHiddenClassName}`}
                >
                    {!showRole ? (
                        <h3 className="peek-hidden-text">{t('sharedPhone.peekHoldOwner')}</h3>
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
                                ? t('sharedPhone.confirmPassToGuest')
                                : t('sharedPhone.confirmHideScreen')}
                        </button>
                    )}
                    {!ownerUnlocked && (
                        <p className="shared-phone-reveal__hint">{t('sharedPhone.unlockHint')}</p>
                    )}
                </div>
                <p className="impostor-secret-warning">{warningText}</p>
            </div>
        );
    }

    if (!currentGuest) {
        return (
            <p className="shared-phone-reveal__done">{t('sharedPhone.allDone')}</p>
        );
    }

    return (
        <div className="shared-phone-reveal">
            <p className="shared-phone-reveal__step">
                {skipOwnerStep ? t('sharedPhone.guestRoleTitle') : t('sharedPhone.stepGuest')}: <strong>{currentGuest.name}</strong>
                {guests.length > 1 && ` (${guestIndex + 1}/${guests.length})`}
            </p>
            <div
                onMouseDown={() => {
                    setShowGuestRole(true);
                    setGuestUnlocked(true);
                }}
                onMouseUp={() => setShowGuestRole(false)}
                onMouseLeave={() => setShowGuestRole(false)}
                onTouchStart={() => {
                    setShowGuestRole(true);
                    setGuestUnlocked(true);
                }}
                onTouchEnd={() => setShowGuestRole(false)}
                className={`peek-panel ${peekPanelExtraClass} ${showGuestRole ? ownerPeekClassName : peekHiddenClassName}`}
            >
                {!showGuestRole ? (
                    <h3 className="peek-hidden-text">
                        {t('sharedPhone.peekHoldGuest', { name: currentGuest.name })}
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
                        {hasMoreGuests ? t('sharedPhone.nextGuest') : t('sharedPhone.doneHideScreen')}
                    </button>
                )}
                {!guestUnlocked && (
                    <p className="shared-phone-reveal__hint">{t('sharedPhone.unlockHint')}</p>
                )}
            </div>
            <p className="impostor-secret-warning">{warningText}</p>
        </div>
    );
}

export default SharedPhoneRoleReveal;
