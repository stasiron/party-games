import {
  getOrCreateClientId,
  updateSessionState,
} from "./sessionRepository";

const SYNC_THROTTLE_MS = 4000;
const BACKUP_PREFIX = "session.backup.";

type SyncPayload = {
  sessionId: string;
  rawState: string;
  version: number;
};

type DebouncedState = {
  timeoutId: number | null;
  scheduled: SyncPayload | null;
  lastSyncAt: number;
};

const trackers = new Map<string, DebouncedState>();
const pendingBackups = new Set<string>();
let reconnectListenerAttached = false;

function getTracker(sessionId: string): DebouncedState {
  const existing = trackers.get(sessionId);
  if (existing) return existing;
  const created: DebouncedState = {
    timeoutId: null,
    scheduled: null,
    lastSyncAt: 0,
  };
  trackers.set(sessionId, created);
  return created;
}

function compressState(rawState: string): string {
  // Lightweight fallback; plug-in lz-string's compressToUTF16 here when installed.
  return rawState;
}

function backupKey(sessionId: string): string {
  return `${BACKUP_PREFIX}${sessionId}`;
}

function putLocalBackup(payload: SyncPayload): void {
  if (typeof window === "undefined") return;
  const key = backupKey(payload.sessionId);
  window.localStorage.setItem(key, JSON.stringify(payload));
  pendingBackups.add(payload.sessionId);
}

function removeLocalBackup(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(backupKey(sessionId));
  pendingBackups.delete(sessionId);
}

async function flushPayload(payload: SyncPayload): Promise<void> {
  const compressed = compressState(payload.rawState);
  await updateSessionState(payload.sessionId, compressed, payload.version);
}

async function performSync(payload: SyncPayload): Promise<void> {
  try {
    await flushPayload(payload);
    removeLocalBackup(payload.sessionId);
  } catch (error) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      putLocalBackup(payload);
      return;
    }
    throw error;
  }
}

async function flushBackupsOnReconnect(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const sessionId of [...pendingBackups]) {
    const raw = window.localStorage.getItem(backupKey(sessionId));
    if (!raw) {
      pendingBackups.delete(sessionId);
      continue;
    }
    try {
      const payload = JSON.parse(raw) as SyncPayload;
      await flushPayload(payload);
      removeLocalBackup(sessionId);
    } catch {
      // Keep backup and retry on the next online event.
    }
  }
}

function ensureOnlineListener(): void {
  if (typeof window === "undefined" || reconnectListenerAttached) return;
  reconnectListenerAttached = true;
  window.addEventListener("online", () => {
    void flushBackupsOnReconnect();
  });
}

export async function scheduleSessionStateSync(
  sessionId: string,
  rawState: string,
  version: number,
  options?: { critical?: boolean }
): Promise<void> {
  if (typeof window === "undefined") return;
  ensureOnlineListener();
  getOrCreateClientId();

  const tracker = getTracker(sessionId);
  tracker.scheduled = { sessionId, rawState, version };
  const now = Date.now();
  const elapsed = now - tracker.lastSyncAt;
  const dueIn = Math.max(0, SYNC_THROTTLE_MS - elapsed);

  if (options?.critical || dueIn === 0) {
    if (tracker.timeoutId !== null) {
      window.clearTimeout(tracker.timeoutId);
      tracker.timeoutId = null;
    }
    const payload = tracker.scheduled;
    tracker.scheduled = null;
    if (!payload) return;
    await performSync(payload);
    tracker.lastSyncAt = Date.now();
    return;
  }

  if (tracker.timeoutId !== null) return;

  tracker.timeoutId = window.setTimeout(() => {
    tracker.timeoutId = null;
    const payload = tracker.scheduled;
    tracker.scheduled = null;
    if (!payload) return;
    void performSync(payload).then(() => {
      tracker.lastSyncAt = Date.now();
    });
  }, dueIn);
}

export async function forceFlushSessionSync(sessionId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const tracker = trackers.get(sessionId);
  if (!tracker?.scheduled) return;

  if (tracker.timeoutId !== null) {
    window.clearTimeout(tracker.timeoutId);
    tracker.timeoutId = null;
  }
  const payload = tracker.scheduled;
  tracker.scheduled = null;
  await performSync(payload);
  tracker.lastSyncAt = Date.now();
}
