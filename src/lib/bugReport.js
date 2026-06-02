import { push, ref, runTransaction } from 'firebase/database';
import { db } from './firebase';
import { appendDiagnosticsToReportLines } from './bugReportDiagnostics';
import { isLowPowerDevice } from './lowPower';
import { ADMISSION_MODES, JOIN_MODES, normalizeAdmission, normalizeJoinMode } from './roomAccess';

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

const MAX_PANEL_LENGTH = 160;

let cachedIpHash = '';
let cachedIpHashAt = 0;

function hasSubtleDigest() {
    return typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
}

/** 64 zn. hex — fallback gdy brak crypto.subtle (HTTP na imprezie, nie localhost). */
function fingerprintHex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const chunks = [];
    let seedA = 0x811c9dc5;
    let seedB = 0x01000193;

    for (let round = 0; round < 4; round++) {
        for (let i = 0; i < bytes.length; i++) {
            seedA = Math.imul(seedA ^ bytes[i], 0x01000193) >>> 0;
            seedB = (Math.imul(31, seedB) + bytes[i]) >>> 0;
        }
        chunks.push(seedA.toString(16).padStart(8, '0'), seedB.toString(16).padStart(8, '0'));
    }

    return chunks.join('').padEnd(64, '0').slice(0, 64);
}

async function sha256Hex(value) {
    if (hasSubtleDigest()) {
        try {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
            return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        } catch {
            // secure context / polityka przeglądarki — fallback poniżej
        }
    }
    return fingerprintHex(value);
}

function createDeviceId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getDeviceFallbackHash() {
    if (typeof window === 'undefined') return sha256Hex('device:unknown');
    let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        deviceId = createDeviceId();
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
    }).slice(0, MAX_PANEL_LENGTH);
    const nick = (playerName || accountNickname || '').trim().slice(0, 24) || null;
    const role = effectiveIsHost || isHost ? 'host' : entryRole === 'guest' ? 'guest' : 'none';
    const joinMode = roomId ? normalizeJoinMode({ joinMode: currentRoomJoinMode }) : null;
    const admission = roomId ? normalizeAdmission({ admission: roomAdmission }) : null;

    return {
        v: (version || '').slice(0, 32),
        roomId: roomId ? String(roomId).slice(0, 16) : null,
        gameId: gameId ? String(gameId).slice(0, 64) : null,
        gameName: gameName ? String(gameName).slice(0, 64) : null,
        theme: themePreset ? String(themePreset).slice(0, 32) : null,
        email: authEmail ? String(authEmail).slice(0, 128) : null,
        conn: connectionMode ? String(connectionMode).slice(0, 16) : null,
        path:
            typeof window !== 'undefined'
                ? `${window.location.pathname}${window.location.search}`.slice(0, 256)
                : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 256) : null,
        panel,
        screen: String(screen).slice(0, 32),
        role,
        inGame: Boolean(isJoined && roomId),
        playerCount: Math.min(64, Math.max(0, playerStats?.active ?? 0)),
        playersTotal: Math.min(64, Math.max(0, playerStats?.total ?? 0)),
        playersOnline: Math.min(64, Math.max(0, playerStats?.online ?? 0)),
        pendingJoin: Math.min(64, Math.max(0, playerStats?.pendingJoin ?? 0)),
        joinMode: joinMode && JOIN_MODES.includes(joinMode) ? joinMode : null,
        admission: admission && ADMISSION_MODES.includes(admission) ? admission : null,
        nick,
        playerId: myPlayerId ? String(myPlayerId).slice(0, 64) : null,
        lowPower: isLowPowerDevice(),
    };
}

function compactPayload(payload) {
    return Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== null && value !== undefined)
    );
}

function mapFirebaseError(error) {
    const code = error?.code || error?.message || '';
    if (code === 'PERMISSION_DENIED' || String(code).includes('PERMISSION_DENIED')) {
        return new Error('PERMISSION_DENIED');
    }
    return error instanceof Error ? error : new Error('SUBMIT_FAILED');
}

async function acquireBugReportLease(ipHash) {
    const leaseRef = ref(db, `${BUG_REPORT_LEASES_ROOT}/${ipHash}`);
    const now = Date.now();
    let result;
    try {
        result = await runTransaction(leaseRef, (current) => {
            if (current?.expiresAt > now) {
                return;
            }
            return {
                expiresAt: now + LEASE_MS,
                updatedAt: now,
            };
        });
    } catch (error) {
        throw mapFirebaseError(error);
    }

    if (!result.committed) {
        throw new Error('RATE_LIMIT');
    }
}

const CONTEXT_FIELD_LABELS = {
    v: 'Wersja aplikacji',
    roomId: 'Kod pokoju',
    gameId: 'ID gry',
    gameName: 'Nazwa gry',
    theme: 'Motyw',
    email: 'Konto (email)',
    conn: 'Tryb Firebase',
    path: 'Ścieżka (pathname + query)',
    panel: 'Panel / ekran (opis)',
    screen: 'ID ekranu',
    role: 'Rola',
    inGame: 'W trakcie gry',
    playerCount: 'Aktywni gracze',
    playersTotal: 'Gracze (łącznie)',
    playersOnline: 'Gracze online',
    pendingJoin: 'Prośby o dołączenie',
    joinMode: 'Tryb dołączania do pokoju',
    admission: 'Admission pokoju',
    nick: 'Nick gracza',
    playerId: 'ID gracza (RTDB)',
    lowPower: 'Tryb oszczędny (low power)',
};

function formatValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'tak' : 'nie';
    return String(value);
}

function appendSection(lines, title, entries) {
    lines.push('', `--- ${title} ---`);
    for (const [label, value] of entries) {
        if (value === null || value === undefined || value === '') continue;
        lines.push(`${label}: ${value}`);
    }
}

function collectBrowserEnvironment(locale) {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return [];
    }

    const { location } = window;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const displayStandalone =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches;
    const entries = [
        ['Pełny URL', location.href],
        ['Host', location.host],
        ['Protokół', location.protocol],
        ['Query', location.search || '—'],
        ['Hash', location.hash || '—'],
        ['Referrer', document.referrer || '—'],
        ['Język UI', locale || '—'],
        ['Języki przeglądarki', (navigator.languages || [navigator.language]).join(', ')],
        ['Strefa czasowa', Intl.DateTimeFormat().resolvedOptions().timeZone],
        ['User-Agent', navigator.userAgent],
        ['Platforma', navigator.platform || '—'],
        ['Online', navigator.onLine ? 'tak' : 'nie'],
        ['Widoczność karty', document.visibilityState],
        ['Secure context', window.isSecureContext ? 'tak' : 'nie'],
        ['PWA (standalone)', displayStandalone ? 'tak' : 'nie'],
        [
            'Viewport',
            `${window.innerWidth}×${window.innerHeight} (outer ${window.outerWidth}×${window.outerHeight})`,
        ],
        ['Ekran', `${window.screen.width}×${window.screen.height}`],
        ['devicePixelRatio', String(window.devicePixelRatio ?? '—')],
        ['colorScheme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'],
    ];

    if (connection) {
        entries.push(
            ['Sieć (effectiveType)', connection.effectiveType || '—'],
            ['Sieć (downlink Mbps)', connection.downlink != null ? String(connection.downlink) : '—'],
            ['Sieć (rtt ms)', connection.rtt != null ? String(connection.rtt) : '—']
        );
    }
    if (navigator.hardwareConcurrency != null) {
        entries.push(['CPU (logiczne rdzenie)', String(navigator.hardwareConcurrency)]);
    }
    if (navigator.deviceMemory != null) {
        entries.push(['RAM urządzenia (GB, przybliż.)', String(navigator.deviceMemory)]);
    }

    return entries;
}

/**
 * Tekst do wklejenia w maila — pełny kontekst bez haseł i bez surowego IP.
 */
export function formatBugReportClipboardText({
    category,
    categoryLabel,
    message,
    context,
    locale,
    diagnostics,
}) {
    const lines = ['=== Paty Games — raport błędu ==='];
    const now = new Date();
    lines.push(`Wygenerowano: ${now.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

    const userEntries = [];
    if (category) {
        userEntries.push(['Kategoria (id)', category]);
    }
    if (categoryLabel) {
        userEntries.push(['Kategoria', categoryLabel]);
    }
    const trimmedMessage = (message || '').trim();
    userEntries.push(['Wiadomość użytkownika', trimmedMessage || '—']);
    appendSection(lines, 'Opis od użytkownika', userEntries);

    const contextEntries = Object.keys(CONTEXT_FIELD_LABELS).map((key) => [
        CONTEXT_FIELD_LABELS[key],
        formatValue(context?.[key]),
    ]);
    if (context?.ua) {
        contextEntries.push(['User-Agent (z kontekstu)', context.ua]);
    }
    appendSection(lines, 'Kontekst aplikacji', contextEntries);

    appendSection(lines, 'Środowisko przeglądarki', collectBrowserEnvironment(locale));

    appendDiagnosticsToReportLines(lines, diagnostics);

    lines.push(
        '',
        '--- Uwagi ---',
        'Nie zawiera haseł pokoju ani tokenów.',
        'Jeśli wysyłanie przez aplikację nie działa, wklej ten tekst w wiadomość e-mail.'
    );

    return lines.join('\n');
}

export async function copyBugReportToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // HTTP / brak uprawnień — fallback poniżej
        }
    }

    if (typeof document === 'undefined') {
        throw new Error('CLIPBOARD_UNAVAILABLE');
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        const ok = document.execCommand('copy');
        if (!ok) throw new Error('CLIPBOARD_UNAVAILABLE');
    } finally {
        document.body.removeChild(textarea);
    }
}

export async function submitBugReport({ category, message, context }) {
    if (!category) {
        throw new Error('NO_CATEGORY');
    }

    const { ipHash, ipSource } = await resolveReporterIpHash();
    await acquireBugReportLease(ipHash);

    const trimmedMessage = (message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    const payload = compactPayload({
        category,
        createdAt: Date.now(),
        ipHash,
        ipSource,
        ...context,
    });
    if (trimmedMessage) {
        payload.message = trimmedMessage;
    }

    try {
        await push(ref(db, BUG_REPORTS_ROOT), payload);
    } catch (error) {
        throw mapFirebaseError(error);
    }
}
