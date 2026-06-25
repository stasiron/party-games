import { ref, runTransaction } from 'firebase/database';
import { db } from './firebase';
import { get } from './rtdb';

export const APP_METRICS_ROOT = 'appMetrics';
export const METRICS_HISTORY_DAYS = 14;

const METRIC_KEYS = ['deviceJoins', 'playerJoins', 'gamesStarted', 'roomsCreated'];
const recentDedupe = new Map();

/** Klucz dnia w UTC (spójny między klientami). */
export function formatMetricsDayKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

export function formatMetricsDayLabel(dayKey) {
    const raw = String(dayKey || '');
    if (!/^\d{8}$/.test(raw)) return raw;
    return `${raw.slice(6, 8)}.${raw.slice(4, 6)}.${raw.slice(0, 4)}`;
}

export function listRecentMetricsDayKeys(days = METRICS_HISTORY_DAYS, fromDate = new Date()) {
    const keys = [];
    const cursor = new Date(Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate()
    ));
    for (let i = 0; i < days; i += 1) {
        keys.push(formatMetricsDayKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return keys;
}

export function normalizeDailyMetricsBucket(raw) {
    const bucket = raw && typeof raw === 'object' ? raw : {};
    const normalized = {
        deviceJoins: Math.max(0, Number(bucket.deviceJoins || 0)),
        playerJoins: Math.max(0, Number(bucket.playerJoins || 0)),
        gamesStarted: Math.max(0, Number(bucket.gamesStarted || 0)),
        roomsCreated: Math.max(0, Number(bucket.roomsCreated || 0)),
        updatedAt: Number(bucket.updatedAt || 0),
        byGame: {},
    };
    const byGame = bucket.byGame && typeof bucket.byGame === 'object' ? bucket.byGame : {};
    for (const [gameId, entry] of Object.entries(byGame)) {
        if (!gameId || !entry || typeof entry !== 'object') continue;
        normalized.byGame[gameId] = {
            gamesStarted: Math.max(0, Number(entry.gamesStarted || 0)),
            roomsCreated: Math.max(0, Number(entry.roomsCreated || 0)),
        };
    }
    return normalized;
}

function shouldRecordDedupe(key, ttlMs = 4000) {
    const now = Date.now();
    const last = recentDedupe.get(key) || 0;
    if (now - last < ttlMs) return false;
    recentDedupe.set(key, now);
    return true;
}

function hasSessionFlag(key) {
    if (typeof window === 'undefined') return false;
    try {
        return window.sessionStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function setSessionFlag(key) {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(key, '1');
    } catch {
        /* ignore */
    }
}

async function incrementDailyMetric(metricKey, { gameId } = {}) {
    if (!METRIC_KEYS.includes(metricKey)) return;
    const dayKey = formatMetricsDayKey();
    const dayRef = ref(db, `${APP_METRICS_ROOT}/daily/${dayKey}`);
    try {
        await runTransaction(dayRef, (current) => {
            const next = normalizeDailyMetricsBucket(current);
            next[metricKey] += 1;
            next.updatedAt = Date.now();
            if (gameId && (metricKey === 'gamesStarted' || metricKey === 'roomsCreated')) {
                const currentGame = next.byGame[gameId] || { gamesStarted: 0, roomsCreated: 0 };
                currentGame[metricKey] = (currentGame[metricKey] || 0) + 1;
                next.byGame[gameId] = currentGame;
            }
            return next;
        });
    } catch {
        /* best effort — metryki nie mogą blokować gry */
    }
}

export function recordRoomCreated(gameId) {
    if (!gameId) return;
    const dedupeKey = `metrics:roomCreated:${gameId}`;
    if (!shouldRecordDedupe(dedupeKey, 15000)) return;
    void incrementDailyMetric('roomsCreated', { gameId });
}

export function recordNewPlayerJoin({ isGuest = false, dedupeKey } = {}) {
    if (!dedupeKey || !shouldRecordDedupe(`metrics:join:${dedupeKey}`, 60000)) return;
    void incrementDailyMetric('playerJoins');
    if (!isGuest) {
        void incrementDailyMetric('deviceJoins');
    }
}

export function recordGameStarted(roomId, gameId) {
    if (!roomId || !gameId) return;
    const sessionKey = `metrics:gameStarted:${roomId}`;
    if (hasSessionFlag(sessionKey)) return;
    setSessionFlag(sessionKey);
    void incrementDailyMetric('gamesStarted', { gameId });
}

export async function fetchDailyMetrics(days = METRICS_HISTORY_DAYS) {
    const dayKeys = listRecentMetricsDayKeys(days);
    const entries = await Promise.all(
        dayKeys.map(async (dayKey) => {
            const snap = await get(ref(db, `${APP_METRICS_ROOT}/daily/${dayKey}`));
            return {
                dayKey,
                label: formatMetricsDayLabel(dayKey),
                ...normalizeDailyMetricsBucket(snap.val()),
            };
        })
    );
    return entries;
}

export function sumMetricsRows(rows, limit = rows.length) {
    const slice = rows.slice(0, limit);
    const totals = {
        deviceJoins: 0,
        playerJoins: 0,
        gamesStarted: 0,
        roomsCreated: 0,
        byGame: {},
    };
    for (const row of slice) {
        totals.deviceJoins += row.deviceJoins;
        totals.playerJoins += row.playerJoins;
        totals.gamesStarted += row.gamesStarted;
        totals.roomsCreated += row.roomsCreated;
        for (const [gameId, entry] of Object.entries(row.byGame || {})) {
            const current = totals.byGame[gameId] || { gamesStarted: 0, roomsCreated: 0 };
            current.gamesStarted += entry.gamesStarted || 0;
            current.roomsCreated += entry.roomsCreated || 0;
            totals.byGame[gameId] = current;
        }
    }
    return totals;
}
