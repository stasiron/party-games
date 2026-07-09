import { useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { auth as firebaseAuth, firestore } from '../../lib/firebase/client';
import { db } from '../../lib/firebase';
import { APP_CONFIG_PATH, normalizeCmsConfig } from '../../lib/cmsConfig.js';
import { NICKNAME_KEY } from '../constants';

/** Auth listener, CMS config, Firestore nickname preload. */
export function useAppAuth({
    authUser,
    authUserRef,
    gameContentGames,
    setAuthUser,
    setCmsConfig,
    setAccountNickname,
}) {
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
            authUserRef.current = user;
            setAuthUser(user);
        });
        return () => unsubscribe();
    }, [authUserRef, setAuthUser]);

    useEffect(() => {
        const cfgRef = ref(db, APP_CONFIG_PATH);
        const unsubscribe = onValue(cfgRef, (snapshot) => {
            setCmsConfig(normalizeCmsConfig(snapshot.val(), gameContentGames));
        });
        return () => unsubscribe();
    }, [gameContentGames, setCmsConfig]);

    useEffect(() => {
        if (typeof window === 'undefined' || !authUser?.uid) return undefined;
        let active = true;

        const loadNickname = async () => {
            try {
                const snap = await getDoc(doc(firestore, 'users', authUser.uid));
                if (!active || !snap.exists()) return;
                const nick = String(snap.data()?.nickname || '').trim();
                if (nick) {
                    setAccountNickname(nick);
                    window.localStorage.setItem(NICKNAME_KEY, nick);
                }
            } catch {
                /* best effort */
            }
        };

        void loadNickname();
        return () => {
            active = false;
        };
    }, [authUser?.uid, setAccountNickname]);
}
