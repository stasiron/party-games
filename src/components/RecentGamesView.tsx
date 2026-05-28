import { useEffect, useState } from "react";
import { auth, firestore } from "../lib/firebase/client";
import { doc, getDoc } from "firebase/firestore";
import type { UserProfile } from "../types/sessionModels";

type RecentGamesViewProps = {
  onResume: (sessionId: string) => void;
};

export function RecentGamesView({ onResume }: RecentGamesViewProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        if (!active) return;
        setError("Please sign in to view recent sessions.");
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(firestore, "users", uid));
        if (!active) return;
        if (!snap.exists()) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(snap.data() as UserProfile);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load history.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-600">Loading recent games...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }

  const recent = profile?.recentSessions ?? [];
  if (recent.length === 0) {
    return <p className="text-sm text-slate-600">No recent sessions yet.</p>;
  }

  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-slate-300 p-4">
      <h2 className="mb-3 text-lg font-semibold">Recent Games</h2>
      <ul className="space-y-2">
        {recent.map((session) => {
          const canResume =
            session.status === "active" || session.status === "paused";
          return (
            <li
              key={session.sessionId}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
            >
              <div>
                <p className="font-medium">{session.gameType}</p>
                <p className="text-xs text-slate-500">
                  {session.status} - {new Date(session.updatedAt).toLocaleString()}
                </p>
              </div>
              {canResume && (
                <button
                  type="button"
                  onClick={() => onResume(session.sessionId)}
                  className="rounded-md bg-green-600 px-3 py-2 text-white"
                >
                  Resume
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default RecentGamesView;
