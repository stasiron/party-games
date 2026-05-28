import {
  DocumentReference,
  collection,
  doc,
  runTransaction,
} from "firebase/firestore";
import { auth, firestore } from "../../lib/firebase/client";
import type {
  GameSession,
  RecentSession,
  SessionStatus,
  UserProfile,
} from "../../types/sessionModels";

const CLIENT_ID_KEY = "session.clientId";
const MAX_RECENT_SESSIONS = 5;

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("User must be signed in.");
  }
  return uid;
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  window.sessionStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

function getRecentItem(
  sessionId: string,
  gameType: string,
  status: SessionStatus,
  updatedAt: number
): RecentSession {
  return { sessionId, gameType, status, updatedAt };
}

export async function createSession(
  gameType: string,
  initialState: string
): Promise<string> {
  const uid = requireUid();
  const now = Date.now();
  const clientId = getOrCreateClientId();
  const sessionRef = doc(collection(firestore, "sessions"));
  const sessionId = sessionRef.id;
  const userRef = doc(
    firestore,
    "users",
    uid
  ) as DocumentReference<UserProfile>;

  await runTransaction(firestore, async (tx) => {
    const userSnap = await tx.get(userRef);
    const recent = userSnap.exists()
      ? userSnap.data().recentSessions ?? []
      : [];

    const nextRecent = [
      getRecentItem(sessionId, gameType, "active", now),
      ...recent.filter((item) => item.sessionId !== sessionId),
    ].slice(0, MAX_RECENT_SESSIONS);

    const sessionPayload: GameSession = {
      sessionId,
      uid,
      activeClientId: clientId,
      gameType,
      status: "active",
      version: 1,
      stateCompressed: initialState,
      updatedAt: now,
    };

    tx.set(sessionRef, sessionPayload);
    if (userSnap.exists()) {
      tx.update(userRef, { recentSessions: nextRecent, lastLoginAt: now });
    } else {
      tx.set(userRef, {
        nickname: auth.currentUser?.displayName ?? "Player",
        createdAt: now,
        lastLoginAt: now,
        recentSessions: nextRecent,
      } satisfies UserProfile);
    }
  });

  return sessionId;
}

export async function updateSessionState(
  sessionId: string,
  compressedState: string,
  currentVersion: number
): Promise<void> {
  const uid = requireUid();
  const now = Date.now();
  const clientId = getOrCreateClientId();
  const sessionRef = doc(
    firestore,
    "sessions",
    sessionId
  ) as DocumentReference<GameSession>;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) {
      throw new Error("Session not found.");
    }

    const current = snap.data();
    if (current.uid !== uid) {
      throw new Error("Session does not belong to current user.");
    }
    if (current.activeClientId !== clientId) {
      throw new Error("Session is active in another tab.");
    }
    if (current.status === "finished" || current.status === "abandoned") {
      throw new Error("Session is closed.");
    }
    if (current.version !== currentVersion) {
      throw new Error("Version conflict detected.");
    }

    tx.update(sessionRef, {
      stateCompressed: compressedState,
      version: currentVersion + 1,
      updatedAt: now,
    });
  });
}

export async function closeSession(
  sessionId: string,
  finalStatus: "finished" | "abandoned"
): Promise<void> {
  const uid = requireUid();
  const now = Date.now();
  const sessionRef = doc(
    firestore,
    "sessions",
    sessionId
  ) as DocumentReference<GameSession>;
  const userRef = doc(
    firestore,
    "users",
    uid
  ) as DocumentReference<UserProfile>;

  await runTransaction(firestore, async (tx) => {
    const [sessionSnap, userSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(userRef),
    ]);
    if (!sessionSnap.exists()) {
      throw new Error("Session not found.");
    }

    const session = sessionSnap.data();
    if (session.uid !== uid) {
      throw new Error("Session does not belong to current user.");
    }
    if (session.status === "finished" || session.status === "abandoned") {
      return;
    }

    tx.update(sessionRef, { status: finalStatus, updatedAt: now });

    if (!userSnap.exists()) {
      return;
    }

    const currentRecent = userSnap.data().recentSessions ?? [];
    const updatedRecent = currentRecent
      .map((item) =>
        item.sessionId === sessionId
          ? { ...item, status: finalStatus, updatedAt: now }
          : item
      )
      .slice(0, MAX_RECENT_SESSIONS);

    tx.update(userRef, { recentSessions: updatedRecent });
  });
}
