import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyAmG2QBlxeImSqEfxLXXrazq04t-svXkus",
    authDomain: "party-games-14ae8.firebaseapp.com",
    databaseURL: "https://party-games-14ae8-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "party-games-14ae8",
    storageBucket: "party-games-14ae8.appspot.com",
    messagingSenderId: "834176760228",
    appId: "1:834176760228:web:3b13358cebe26fce886931"
};

const EMULATOR_PORT = 9000;

/** Jedyny adres imprezy na Wi‑Fi Malinki (hotspot PartBox-Gry). */
export const PI_AP_GATEWAY = "10.42.0.1";

const LOCAL_PARTY_DOMAINS = new Set([
    "partygames.pb",
    "party.pb",
    "gry.pb",
    "partbox.pb",
]);

function getUrlParams() {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search);
}

/**
 * Emulator tylko na PartBox (10.42.0.1, *.pb) lub gdy wymusisz ?emulator=1.
 * Zwykły LAN (192.168.x.x) i localhost → chmura, chyba że ?lan=1 (test Malinki) lub ?emulator=1.
 * ?cloud=1 — wymusza chmurę nawet na Malinie.
 */
export function isLocalPartyHost(hostname) {
    if (!hostname) return false;

    const params = getUrlParams();
    if (params?.has("cloud")) return false;
    if (params?.has("emulator")) return true;
    if (params?.has("lan") && /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

    if (hostname === PI_AP_GATEWAY) return true;
    if (/^10\.42\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (LOCAL_PARTY_DOMAINS.has(hostname)) return true;
    if (hostname.endsWith(".pb") || hostname.endsWith(".local")) return true;

    return false;
}

/** Czy jesteśmy na kanonicznym hoście imprezy (AP / .pb). */
export function isOnPartyGateway(hostname) {
    if (!hostname) return false;
    if (hostname === PI_AP_GATEWAY || hostname === "localhost") return true;
    if (hostname.endsWith(".pb") || LOCAL_PARTY_DOMAINS.has(hostname)) return true;
    if (/^10\.42\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    return false;
}

/** QR i link — zawsze AP, żeby telefony na PartBox-Gry weszły. */
export function getPartyOrigin() {
    if (typeof window === "undefined") return "";
    const { protocol, hostname } = window.location;
    if (!isLocalPartyHost(hostname)) return window.location.origin;
    if (hostname === "localhost") return window.location.origin;
    const params = new URLSearchParams(window.location.search);
    if (params.has("lan")) return window.location.origin;
    return `${protocol}//${PI_AP_GATEWAY}`;
}

/**
 * Emulator: ten sam host co strona (po przekierowaniu → 10.42.0.1).
 * Wyjątek: ?lan=1 — test z LAN (192.168.1.52).
 */
export function getEmulatorHost(hostname) {
    if (hostname === "localhost") return "localhost";
    if (!isLocalPartyHost(hostname)) return hostname;
    if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.has("lan")) return hostname;
    }
    if (isOnPartyGateway(hostname)) return hostname;
    return PI_AP_GATEWAY;
}

const hostname = typeof window !== "undefined" ? window.location.hostname : "";
const useEmulator = isLocalPartyHost(hostname);
const emulatorHost = useEmulator ? getEmulatorHost(hostname) : null;
const partyOrigin = typeof window !== "undefined" ? getPartyOrigin() : "";
const onPartyGateway = isOnPartyGateway(hostname);

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export const firebaseConnection = {
    mode: useEmulator ? "emulator" : "cloud",
    hostname,
    emulatorHost,
    emulatorPort: EMULATOR_PORT,
    partyOrigin,
    onPartyGateway,
    apGateway: PI_AP_GATEWAY,
    label: useEmulator
        ? `Lokalna baza (${emulatorHost}:${EMULATOR_PORT})`
        : "Chmura Google (wymaga internetu)",
};

if (typeof window !== "undefined") {
    if (useEmulator) {
        connectDatabaseEmulator(db, emulatorHost, EMULATOR_PORT);
    }
    if (import.meta.env.DEV) {
        console.log(`[Firebase] Strona: ${hostname} → emulator: ${emulatorHost ?? "chmura"}`);
        if (useEmulator) {
            console.log(`[Firebase] Emulator (${emulatorHost}:${EMULATOR_PORT}), projekt ${firebaseConfig.projectId}`);
        } else {
            console.log("[Firebase] Chmura Google");
        }
    }
}
