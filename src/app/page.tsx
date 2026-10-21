"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Spinner } from "@/components/ui";
import { getPracticeEngine } from "@/lib/client/practice";
import { usePracticeData } from "@/lib/client/use-practice";
import { getCurrentUser } from "@/lib/client/user";

const NAV = [
  { href: "/vocabulary", emoji: "📚", title: "Vocabulary", text: "Browse, add and edit words" },
  { href: "/import", emoji: "📝", title: "Import a lesson", text: "Turn lesson notes into words" },
  { href: "/settings", emoji: "⚙️", title: "Settings", text: "Language & account" },
  { href: "/shortcuts", emoji: "🎙️", title: "Voice capture", text: "Add words with Siri" },
  { href: "/install", emoji: "📲", title: "Install on iPhone", text: "Home screen & offline use" },
];

export default function HomePage() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => setName(getCurrentUser()?.name ?? null), []);
  const { snapshot, loading, pending } = usePracticeData({ refreshOnMount: "if-missing" });
  const counts = useMemo(
    () => (snapshot ? getPracticeEngine().sections(snapshot).all : null),
    [snapshot],
  );

  return (
    <main className="stack-lg">
      <header className="stack" style={{ gap: "0.25rem" }}>
        <span className="eyebrow">Cards No Cards</span>
        <h1 style={{ margin: 0 }}>¡Hola{name ? `, ${name}` : ""}! 👋</h1>
        <p className="muted">Your Spanish words, practiced a little every day.</p>
      </header>

      <section className="card hero stack flush" aria-label="Today">
        {loading ? (
          <p className="muted row center">
            <Spinner /> Loading…
          </p>
        ) : counts ? (
          <div className="stats">
            <div className="stat">
              <strong>{counts.due}</strong>
              <span>Due now</span>
            </div>
            <div className="stat">
              <strong>{counts.new}</strong>
              <span>New</span>
            </div>
            <div className="stat">
              <strong>{counts.learned}</strong>
              <span>Learned</span>
            </div>
          </div>
        ) : (
          <p className="muted">
            Open Practice once while online to save your words for offline use.
          </p>
        )}
        <Link className="button large block" href="/practice">
          Practice
        </Link>
        {pending > 0 ? (
          <p className="muted small center">
            {pending} answer{pending === 1 ? "" : "s"} waiting to sync
          </p>
        ) : null}
      </section>

      <nav className="nav-list" aria-label="Sections">
        {NAV.map((item) => (
          <Link key={item.href} className="nav-item" href={item.href}>
            <span className="nav-emoji" aria-hidden="true">
              {item.emoji}
            </span>
            <span className="nav-text">
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
            <span className="chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
