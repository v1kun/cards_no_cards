import Link from "next/link";
import type { ReactNode } from "react";

import type { SectionCounts } from "@/domain/review/session-plan";

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Stacked bar: learned (green) and due (amber) out of the section total. */
export function SectionProgress({ counts }: { counts: SectionCounts }) {
  const pct = (n: number) => (counts.total ? `${(n / counts.total) * 100}%` : "0%");
  return (
    <div
      className="progress"
      role="img"
      aria-label={`${counts.learned} learned, ${counts.due} due, ${counts.new} new of ${counts.total}`}
    >
      <span className="learned" style={{ width: pct(counts.learned) }} />
      <span className="due" style={{ width: pct(counts.due) }} />
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className="value" style={{ width: max ? `${(value / max) * 100}%` : "0%" }} />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTile({
  emoji,
  title,
  counts,
  onClick,
  featured,
}: {
  emoji: string;
  title: string;
  counts: SectionCounts;
  onClick: () => void;
  featured?: boolean;
}) {
  const nothing = counts.due === 0 && counts.new === 0;
  return (
    <button type="button" className={`tile${featured ? " featured" : ""}`} onClick={onClick}>
      <span className="tile-emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="tile-title">{title}</span>
      <SectionProgress counts={counts} />
      <span className="tile-meta">
        <span>{counts.total} words</span>
        {counts.due > 0 ? <span className="due">{counts.due} due</span> : null}
        {counts.new > 0 ? <span className="new">{counts.new} new</span> : null}
        {nothing ? <span>all reviewed ✓</span> : null}
      </span>
    </button>
  );
}

export function PageHeader({
  title,
  back,
  aside,
  children,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  /** Shown at the top right, next to the back link (e.g. a status pill). */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header-block">
      {back || aside ? (
        <div className="page-header-top">
          {back ? (
            <Link className="back-link" href={back.href}>
              ← {back.label}
            </Link>
          ) : (
            <span />
          )}
          {aside}
        </div>
      ) : null}
      <div className="spread">
        <h1>{title}</h1>
        {children}
      </div>
    </header>
  );
}
