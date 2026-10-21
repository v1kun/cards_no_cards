"use client";

import { useState, type FormEvent } from "react";

import { Spinner } from "@/components/ui";
import { ApiClientError } from "@/lib/client/api";
import { login, rememberUser } from "@/lib/client/user";

/** Only same-site paths, so `?next=` cannot send the user elsewhere. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await login(username, password);
      rememberUser(user);
      window.location.assign(safeNext());
    } catch (caught) {
      setError(
        caught instanceof ApiClientError && caught.status === 0
          ? "You are offline. Signing in needs a connection."
          : caught instanceof ApiClientError && caught.status === 401
            ? "Wrong login or password."
            : "Could not sign in.",
      );
      setBusy(false);
    }
  };

  return (
    <main className="stack-lg">
      <header className="stack" style={{ gap: "0.25rem" }}>
        <span className="eyebrow">Cards No Cards</span>
        <h1 style={{ margin: 0 }}>Sign in</h1>
      </header>
      <form className="card stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Login</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? (
          <p className="error small" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button large block" disabled={busy}>
          {busy ? <Spinner /> : null} Sign in
        </button>
      </form>
    </main>
  );
}
