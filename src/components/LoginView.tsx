import { FormEvent, useState } from "react";
import {
  completePasswordlessSignIn,
  sendPasswordlessSignInLink,
  signInWithGoogle,
} from "../services/auth/firebaseAuth";

export function LoginView() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleGoogleLogin() {
    setIsBusy(true);
    setStatus("");
    try {
      await signInWithGoogle();
      setStatus("Signed in with Google.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Google sign-in failed."
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setStatus("");
    try {
      await sendPasswordlessSignInLink(email);
      setStatus("Sign-in link sent. Check your email.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not send sign-in link."
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCompleteLink() {
    setIsBusy(true);
    setStatus("");
    try {
      await completePasswordlessSignIn(email);
      setStatus("Email link sign-in complete.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not complete sign-in."
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-300 p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Login</h2>
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={isBusy}
        className="mb-4 w-full rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
      >
        Continue with Google
      </button>

      <form onSubmit={handleSendLink} className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="email-link-input">
          Email for passwordless login
        </label>
        <input
          id="email-link-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          placeholder="you@example.com"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-md bg-blue-600 px-3 py-2 text-white disabled:opacity-60"
          >
            Send Link
          </button>
          <button
            type="button"
            onClick={handleCompleteLink}
            disabled={isBusy}
            className="rounded-md border border-slate-300 px-3 py-2 disabled:opacity-60"
          >
            Complete Sign-In
          </button>
        </div>
      </form>

      {status && <p className="mt-3 text-sm text-slate-700">{status}</p>}
    </section>
  );
}

export default LoginView;
