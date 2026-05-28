import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ??
    "AIzaSyAmG2QBlxeImSqEfxLXXrazq04t-svXkus",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    "party-games-14ae8.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "party-games-14ae8",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "party-games-14ae8.appspot.com",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "834176760228",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ??
    "1:834176760228:web:3b13358cebe26fce886931",
};

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);

// Keep auth session across refresh/restart on this device.
void setPersistence(auth, indexedDBLocalPersistence).catch(() =>
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // In private mode or locked-down browsers persistence can fail.
  })
);
