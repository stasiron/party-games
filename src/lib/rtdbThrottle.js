import { set as firebaseSet, update as firebaseUpdate, get as firebaseGet } from 'firebase/database';
import { isLowPowerDevice, getMinWriteGapMs, getMinReadGapMs } from './lowPower';

let chain = Promise.resolve();
let lastOpAt = 0;
let queueDepth = 0;
const queueListeners = new Set();

let piGameSessionActive = false;
const gameSessionListeners = new Set();

function notifyQueue() {
    queueListeners.forEach((fn) => fn(queueDepth));
}

function notifyGameSession() {
    gameSessionListeners.forEach((fn) => fn(piGameSessionActive));
}

export function subscribePiQueue(listener) {
    queueListeners.add(listener);
    listener(queueDepth);
    return () => queueListeners.delete(listener);
}

export function getPiQueueDepth() {
    return queueDepth;
}

export function setPiGameSessionActive(active) {
    const next = Boolean(active);
    if (piGameSessionActive === next) return;
    piGameSessionActive = next;
    notifyGameSession();
}

export function isPiGameSessionActive() {
    return piGameSessionActive;
}

export function subscribePiGameSession(listener) {
    gameSessionListeners.add(listener);
    listener(piGameSessionActive);
    return () => gameSessionListeners.delete(listener);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kolejka RTDB na Malinie — jedna operacja na raz, min. przerwa między zapisami.
 * minUiMs — świadome opóźnienie UI (gracz widzi krótką synchronizację zamiast freeze).
 */
function enqueue(op, { isWrite = false, minUiMs = 0, priority = false } = {}) {
    if (!isLowPowerDevice()) return op();
    if (priority) return op();

    return new Promise((resolve, reject) => {
        chain = chain
            .then(async () => {
                queueDepth += 1;
                notifyQueue();

                const gapMs = isWrite ? getMinWriteGapMs() : getMinReadGapMs();
                const sinceLast = Date.now() - lastOpAt;
                const gapWait = Math.max(0, gapMs - sinceLast);
                const uiWait = minUiMs > 0 ? Math.max(0, minUiMs - sinceLast) : 0;
                const wait = Math.max(gapWait, uiWait);
                if (wait > 0) await sleep(wait);

                try {
                    return await op();
                } finally {
                    lastOpAt = Date.now();
                    queueDepth = Math.max(0, queueDepth - 1);
                    notifyQueue();
                }
            })
            .then(resolve, reject);
    });
}

export function piSet(dbRef, value, options) {
    const minUiMs = options?.minUiMs ?? 0;
    const priority = options?.priority === true;
    return enqueue(() => firebaseSet(dbRef, value), { isWrite: true, minUiMs, priority });
}

export function piUpdate(dbRef, values, options) {
    const minUiMs = options?.minUiMs ?? 0;
    const priority = options?.priority === true;
    return enqueue(() => firebaseUpdate(dbRef, values), { isWrite: true, minUiMs, priority });
}

export function piGet(dbRef) {
    return enqueue(() => firebaseGet(dbRef), { isWrite: false });
}
