import { push, ref, runTransaction } from 'firebase/database';
import { db } from './firebase';
import { isLowPowerDevice } from './lowPower';

export const BUG_REPORT_CATEGORIES = [
    { id: 'styling', label: 'Kolorystyka / wygląd' },
    { id: 'ui-buttons', label: 'Przyciski / interfejs' },
    { id: 'game-logic', label: 'Logika gry' },
    { id: 'missing-feature', label: 'Brak funkcji' },
    { id: 'connection', label: 'Połączenie / sieć' },
    { id: 'other', label: 'Inne' },
];

const BUG_REPORTS_ROOT = 'bugReports';
const BUG_REPORT_LEASES_ROOT = 'bugReportLeases';
const MAX_MESSAGE_LENGTH = 2000;
const LEASE_MS = 5 * 60 * 1000;
const IP_LOOKUP_TIMEOUT_MS = 2500;
const IP_HASH_CACHE_MS = 10 * 60 * 1000;
const DEVICE_ID_KEY = 'partyGames.bugReportDevice.v1';

let cachedIpHash = '';
let cachedIpHashAt = 0;

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getDeviceFallbackHash() {
    if (typeof window === 'undefined') return sha256Hex('device:unknown');
    let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return sha256Hex(`device:${deviceId}`);
}

async function fetchPublicIp() {
    if (typeof fetch === 'undefined') return null;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);
    try {
        const response = await fetch('https://api64.ipify.org?format=json', {
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const ip = String(payload?.ip || '').trim();
        return ip || null;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function resolveReporterIpHash() {
    const now = Date.now();
    if (cachedIpHash && now - cachedIpHashAt < IP_HASH_CACHE_MS) {
        return { ipHash: cachedIpHash, ipSource: 'cache' };
    }

    const publicIp = await fetchPublicIp();
    const ipHash = publicIp ? await sha256Hex(`ip:${publicIp}`) : await getDeviceFallbackHash();
    cachedIpHash = ipHash;
    cachedIpHashAt = now;
    return { ipHash, ipSource: publicIp ? 'public-ip' : 'device-fallback' };
}

export function prefetchReporterIpHash() {
    void resolveReporterIpHash();
}

export function resolveBugReportScreen({
    selectedGame,
    entryRole,
    isJoined,
    isHost,
    effectiveIsHost,
    waitingForApproval,
    guestPasswordPending,
}) {
    if (!selectedGame) {
        if (!entryRole) return 'lobby-role-select';
        if (entryRole === 'host') return 'lobby-host-create';
        return 'lobby-guest-join';
    }
    if (!isJoined) {
        if (waitingForApproval) return 'room-waiting-approval';
        if (guestPasswordPending) return 'room-guest-password';
        if (isHost) return 'room-host-prejoin';
        return 'room-guest-prejoin';
    }
    return effectiveIsHost ? 'room-host-ingame' : 'room-player-ingame';
}

export function formatBugReportPanel({
    screen,
    gameName,
    roomId,
    entryRole,
    isHost,
    effectiveIsHost,
}) {
    const gameLabel = gameName || 'gra';
    const roomLabel = roomId ? ` (${roomId})` : '';

    switch (screen) {
        case 'lobby-role-select':
            return 'Lobby — wybór roli (host / gość)';
        case 'lobby-host-create':
            return 'Lobby — panel hosta (wybór gry)';
        case 'lobby-guest-join':
            return 'Lobby — panel gościa (lista pokoi)';
        case 'room-waiting-approval':
            return `Pokój — oczekiwanie na akceptację hosta · ${gameLabel}${roomLabel}`;
        case 'room-guest-password':
            return `Pokój — ekran hasła · ${gameLabel}${roomLabel}`;
        case 'room-host-prejoin':
            return `Panel hosta — przed startem · ${gameLabel}${roomLabel}`;
        case 'room-guest-prejoin':
            return `Panel gościa — wpisywanie nicku · ${gameLabel}${roomLabel}`;
        case 'room-host-ingame':
            return `Panel hosta w grze · ${gameLabel}${roomLabel}`;
        case 'room-player-ingame':
            return `Panel gracza w grze · ${gameLabel}${roomLabel}`;
        default: {
            if (entryRole === 'host' || isHost || effectiveIsHost) {
                return `Panel hosta · ${gameLabel}${roomLabel}`;
            }
            if (entryRole === 'guest') {
                return `Panel gościa · ${gameLabel}${roomLabel}`;
            }
            return 'Nieznany ekran aplikacji';
        }
    }
}

export function buildBugReportContext({
    version,
    roomId,
    gameId,
    gameName,
    themePreset,
    authEmail,
    connectionMode,
    entryRole,
    isJoined,
    isHost,
    effectiveIsHost,
    waitingForApproval,
    guestPasswordPending,
    currentRoomJoinMode,
    roomAdmission,
    playerName,
    accountNickname,
    myPlayerId,
    playerStats,
}) {
    const screen = resolveBugReportScreen({
        selectedGame: roomId,
        entryRole,
        isJoined,
        isHost,
        effectiveIsHost,
        waitingForApproval,
        guestPasswordPending,
    });
    const panel = formatBugReportPanel({
        screen,
        gameName,
        roomId,
        entryRole,
        isHost,
        effectiveIsHost,
    });
    const nick = (playerName || accountNickname || '').trim().slice(0, 24) || null;

    return {
        v: version || '',
        roomId: roomId || null,
        gameId: gameId || null,
        gameName: gameName || null,
        theme: themePreset || null,
        email: authEmail || null,
        conn: connectionMode || null,
        path:
            typeof window !== 'undefined'
                ? `${window.location.pathname}${window.location.search}`
                : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 256) : null,
        panel,
        screen,
        role: effectiveIsHost || isHost ? 'host' : entryRole === 'guest' ? 'guest' : entryRole || 'none',
        inGame: Boolean(isJoined && roomId),
        playerCount: playerStats?.active ?? 0,
        playersTotal: playerStats?.total ?? 0,
        playersOnline: playerStats?.online ?? 0,
        pendingJoin: playerStats?.pendingJoin ?? 0,
        joinMode: roomId ? currentRoomJoinMode || null : null,
        admission: roomId ? roomAdmission || null : null,
        nick,
        playerId: myPlayerId || null,
        lowPower: isLowPowerDevice(),
    };
}

async function acquireBugReportLease(ipHash) {
    const leaseRef = ref(db, `${BUG_REPORT_LEASES_ROOT}/${ipHash}`);
    const now = Date.now();
    const result = await runTransaction(leaseRef, (current) => {
        if (current?.expiresAt > now) {
            return;
        }
        return {
            expiresAt: now + LEASE_MS,
            updatedAt: now,
        };
    });

    if (!result.committed) {
        throw new Error('RATE_LIMIT');
    }
}

export async function submitBugReport({ category, message, context }) {
    if (!category) {
        throw new Error('NO_CATEGORY');
    }

    const { ipHash, ipSource } = await resolveReporterIpHash();
    await acquireBugReportLease(ipHash);

    const trimmedMessage = (message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    const payload = {
        category,
        createdAt: Date.now(),
        ipHash,
        ipSource,
        ...context,
    };
    if (trimmedMessage) {
        payload.message = trimmedMessage;
    }

    await push(ref(db, BUG_REPORTS_ROOT), payload);
}
