import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// TUTAJ WKLEJ SWOJE DANE Z KONSOLI FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyAmG2QBlxeImSqEfxLXXrazq04t-svXkus",
    authDomain: "party-games-14ae8.firebaseapp.com",
    databaseURL: "https://party-games-14ae8-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "party-games-14ae8",
    storageBucket: "party-games-14ae8.appspot.com",
    messagingSenderId: "834176760228",
    appId: "1:834176760228:web:3b13358cebe26fce886931"
};

// Inicjalizacja aplikacji Firebase
const app = initializeApp(firebaseConfig);

// Otwarcie połączenia z bazą Realtime Database i wyeksportowanie jej
export const db = getDatabase(app);