import {
  browserLocalPersistence,
  GoogleAuthProvider,
  User,
  indexedDBLocalPersistence,
  isSignInWithEmailLink,
  setPersistence,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
} from "firebase/auth";
import {
  DocumentReference,
  doc,
  runTransaction,
} from "firebase/firestore";
import { auth, firestore } from "../../lib/firebase/client";

type UserProfile = {
  nickname: string;
  createdAt: number;
  lastLoginAt: number;
  recentSessions: Array<{
    sessionId: string;
    gameType: string;
    status: string;
    updatedAt: number;
  }>;
};

const EMAIL_STORAGE_KEY = "auth.emailForSignIn";

let persistenceReadyPromise: Promise<void> | null = null;

function ensurePersistentAuth(): Promise<void> {
  if (!persistenceReadyPromise) {
    persistenceReadyPromise = setPersistence(auth, indexedDBLocalPersistence)
      .catch(() => setPersistence(auth, browserLocalPersistence))
      .then(() => undefined);
  }
  return persistenceReadyPromise;
}

function toFriendlyAuthError(error: unknown): Error {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "auth/configuration-not-found") {
    return new Error(
      "Firebase Auth is not configured. Enable Google Sign-in and authorize this domain in Firebase Console."
    );
  }
  if (code === "auth/unauthorized-domain") {
    return new Error(
      "Current domain is not authorized for Firebase Auth. Add this host in Authentication > Settings > Authorized domains."
    );
  }

  if (error instanceof Error) {
    return error;
  }
  return new Error("Authentication failed.");
}

function ensureEmailLinkUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("Email link auth requires a browser environment.");
  }
  return `${window.location.origin}${window.location.pathname}`;
}

function buildInitialUserProfile(user: User, now: number): UserProfile {
  return {
    nickname: (user.displayName ?? user.email?.split("@")[0] ?? "Player").slice(
      0,
      24
    ),
    createdAt: now,
    lastLoginAt: now,
    recentSessions: [],
  };
}

function normalizeProfile(
  existing: Partial<UserProfile> | undefined,
  fallback: UserProfile,
  now: number
): UserProfile {
  return {
    nickname:
      typeof existing?.nickname === "string" && existing.nickname.trim()
        ? existing.nickname.slice(0, 24)
        : fallback.nickname,
    createdAt:
      typeof existing?.createdAt === "number"
        ? existing.createdAt
        : fallback.createdAt,
    lastLoginAt: now,
    recentSessions: Array.isArray(existing?.recentSessions)
      ? existing.recentSessions.slice(0, 5)
      : [],
  };
}

async function ensureUserDocument(user: User): Promise<void> {
  const userRef = doc(firestore, "users", user.uid) as DocumentReference<UserProfile>;
  const now = Date.now();

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(userRef);
    const baseProfile = buildInitialUserProfile(user, now);

    if (!snap.exists()) {
      tx.set(userRef, baseProfile);
      return;
    }

    const normalized = normalizeProfile(snap.data(), baseProfile, now);
    tx.set(userRef, normalized, { merge: true });
  });
}

export async function signInWithGoogle() {
  try {
    await ensurePersistentAuth();
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    await ensureUserDocument(credential.user);
    return credential.user;
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
}

export async function sendPasswordlessSignInLink(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  try {
    await ensurePersistentAuth();
    await sendSignInLinkToEmail(auth, normalizedEmail, {
      url: ensureEmailLinkUrl(),
      handleCodeInApp: true,
    });
  } catch (error) {
    throw toFriendlyAuthError(error);
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(EMAIL_STORAGE_KEY, normalizedEmail);
  }
}

export async function completePasswordlessSignIn(
  incomingEmail?: string
): Promise<User> {
  if (typeof window === "undefined") {
    throw new Error("Email link completion requires a browser environment.");
  }

  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) {
    throw new Error("Current URL is not a valid sign-in email link.");
  }

  const email =
    incomingEmail?.trim().toLowerCase() ||
    window.localStorage.getItem(EMAIL_STORAGE_KEY) ||
    "";
  if (!email) {
    throw new Error("Email is required to complete passwordless sign-in.");
  }

  try {
    await ensurePersistentAuth();
    const credential = await signInWithEmailLink(auth, email, href);
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);
    await ensureUserDocument(credential.user);
    return credential.user;
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
}
