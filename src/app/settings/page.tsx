"use client";

import { useEffect, useState } from "react";

import { PageHeader, Spinner } from "@/components/ui";
import { ApiClientError } from "@/lib/client/api";
import { getPracticeEngine, signOut } from "@/lib/client/practice";
import { getCurrentUser, type CurrentUser } from "@/lib/client/user";
import {
  getProfile,
  updateProfile,
  type Profile,
  type TranslationLanguage,
} from "@/lib/client/profile";

const LANGUAGES: { value: TranslationLanguage; label: string; native: string; flag: string }[] = [
  { value: "en", label: "English", native: "English", flag: "🇬🇧" },
  { value: "ru", label: "Russian", native: "Русский", flag: "🇷🇺" },
];

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState<TranslationLanguage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => setUser(getCurrentUser()), []);

  const leave = async () => {
    setAccountError(null);
    const pending = await getPracticeEngine()
      .pendingCount()
      .catch(() => 0);
    if (
      pending > 0 &&
      !window.confirm(
        `${pending} answer(s) are not synced yet and will be lost on this device. Sign out anyway?`,
      )
    ) {
      return;
    }
    setSigningOut(true);
    try {
      if (pending > 0)
        await getPracticeEngine()
          .sync()
          .catch(() => undefined);
      await signOut();
      window.location.assign("/login");
    } catch {
      setAccountError("Signing out needs a connection to the server.");
      setSigningOut(false);
    }
  };

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch((caught: unknown) =>
        setError(
          caught instanceof ApiClientError && caught.status === 0
            ? "You are offline. Settings need a connection."
            : "Could not load your settings.",
        ),
      );
  }, []);

  const choose = async (value: TranslationLanguage) => {
    if (!profile || value === profile.translationLanguage) return;
    setSaving(value);
    setError(null);
    setMessage(null);
    try {
      setProfile(await updateProfile({ translationLanguage: value }));
      setMessage(
        "Saved. Generate questions again on the Practice page so prepared questions use this language.",
      );
      void getPracticeEngine()
        .refresh()
        .catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <main>
      <PageHeader title="Settings" back={{ href: "/", label: "Home" }} />

      <section className="card stack" aria-labelledby="lang-title">
        <div className="stack" style={{ gap: "0.25rem" }}>
          <h2 id="lang-title">Translation language</h2>
          <p className="muted small">
            The language used for translations of new words, generated questions and section names.
            Words you already added keep their existing translations.
          </p>
        </div>
        {!profile && !error ? (
          <p className="muted row center">
            <Spinner /> Loading…
          </p>
        ) : null}
        {profile ? (
          <div className="options" role="radiogroup" aria-label="Translation language">
            {LANGUAGES.map((language) => {
              const selected = profile.translationLanguage === language.value;
              return (
                <button
                  key={language.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`option${selected ? " correct" : ""}`}
                  disabled={saving !== null}
                  onClick={() => void choose(language.value)}
                >
                  <span aria-hidden="true" style={{ fontSize: "1.3rem" }}>
                    {language.flag}
                  </span>
                  <span style={{ flex: 1 }}>
                    {language.native}
                    {language.native !== language.label ? (
                      <span className="muted small"> · {language.label}</span>
                    ) : null}
                  </span>
                  {saving === language.value ? <Spinner /> : selected ? <span>✓</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {message ? <p className="notice small">{message}</p> : null}
        {error ? <p className="error small">{error}</p> : null}
      </section>

      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <p className="muted small">
          Signed in as <strong>{user?.name ?? "…"}</strong>. Signing out removes this account&apos;s
          offline copy from the device.
        </p>
        {accountError ? <p className="error small">{accountError}</p> : null}
        <div>
          <button
            type="button"
            className="secondary"
            disabled={signingOut}
            onClick={() => void leave()}
          >
            {signingOut ? <Spinner /> : null} Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
