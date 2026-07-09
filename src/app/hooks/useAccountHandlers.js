import { useCallback } from 'react';
import { GoogleAuthProvider, linkWithPopup, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth as firebaseAuth, firestore } from '../../lib/firebase/client';
import { NICKNAME_KEY } from '../constants';

export function useAccountHandlers({
    accountEmail,
    accountNickname,
    authUser,
    setAuthBusy,
    setAuthStatus,
    setAccountNickname,
    setNicknameSavedAt,
    setPlayerName,
    t,
}) {
    const hasGoogleProvider = !!authUser?.providerData?.some(
        (provider) => provider.providerId === 'google.com'
    );
    const hasEmailProvider = !!authUser?.providerData?.some(
        (provider) => provider.providerId === 'password'
    );

    const handleGoogleAuth = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../../services/auth/firebaseAuth');
            await authModule.signInWithGoogle();
            setAuthStatus('Zalogowano przez Google.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Logowanie Google nie powiodło się.');
        } finally {
            setAuthBusy(false);
        }
    }, [setAuthBusy, setAuthStatus]);

    const handleSendMagicLink = useCallback(async () => {
        const email = accountEmail.trim();
        if (!email) {
            setAuthStatus('Podaj email do linku logowania.');
            return;
        }
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../../services/auth/firebaseAuth');
            await authModule.sendPasswordlessSignInLink(email);
            setAuthStatus('Wysłano link logowania na email.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się wysłać linku.');
        } finally {
            setAuthBusy(false);
        }
    }, [accountEmail, setAuthBusy, setAuthStatus]);

    const handleCompleteMagicLink = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            const authModule = await import('../../services/auth/firebaseAuth');
            await authModule.completePasswordlessSignIn(accountEmail);
            setAuthStatus('Konto połączone przez email link.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się dokończyć logowania.');
        } finally {
            setAuthBusy(false);
        }
    }, [accountEmail, setAuthBusy, setAuthStatus]);

    const handleConnectGoogle = useCallback(async () => {
        if (!firebaseAuth.currentUser) {
            setAuthStatus('Najpierw zaloguj się lub utwórz konto.');
            return;
        }
        setAuthBusy(true);
        setAuthStatus('');
        try {
            await linkWithPopup(firebaseAuth.currentUser, new GoogleAuthProvider());
            setAuthStatus('Połączono konto z Google.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się połączyć konta.');
        } finally {
            setAuthBusy(false);
        }
    }, [setAuthBusy, setAuthStatus]);

    const handleSignOut = useCallback(async () => {
        setAuthBusy(true);
        setAuthStatus('');
        try {
            await signOut(firebaseAuth);
            setAuthStatus('Wylogowano.');
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : 'Nie udało się wylogować.');
        } finally {
            setAuthBusy(false);
        }
    }, [setAuthBusy, setAuthStatus]);

    const handleSaveNickname = useCallback(async () => {
        const nickname = accountNickname.trim().slice(0, 24);
        if (!nickname) {
            setAuthStatus('Nick nie może być pusty.');
            return;
        }

        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(NICKNAME_KEY, nickname);
            }
            setNicknameSavedAt(Date.now());
        } catch {
            /* ignore local storage failures */
        }

        setAuthBusy(true);
        setAuthStatus('');
        try {
            if (firebaseAuth.currentUser?.uid) {
                await setDoc(
                    doc(firestore, 'users', firebaseAuth.currentUser.uid),
                    { nickname },
                    { merge: true }
                );
                setAuthStatus(t('account.savedRemote'));
            } else {
                setAuthStatus(t('account.savedLocal'));
            }
            setPlayerName((prev) => (prev.trim() ? prev : nickname));
        } catch (error) {
            setAuthStatus(error instanceof Error ? error.message : t('account.saveFailed'));
        } finally {
            setAuthBusy(false);
        }
    }, [accountNickname, setAuthBusy, setAuthStatus, setNicknameSavedAt, setPlayerName, t]);

    return {
        hasGoogleProvider,
        hasEmailProvider,
        handleGoogleAuth,
        handleSendMagicLink,
        handleCompleteMagicLink,
        handleConnectGoogle,
        handleSignOut,
        handleSaveNickname,
    };
}
