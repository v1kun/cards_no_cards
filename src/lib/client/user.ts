"use client";

import { apiFetch } from "./api";

/**
 * The signed-in user as remembered by this device. Stored in localStorage so
 * the offline engine knows whose data to open without a network round-trip.
 */
export type CurrentUser = { userId: string; name: string };

const STORAGE_KEY = "cnc-user";
const FALLBACK_USER = "anonymous";

export function getCurrentUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

/** The id used to scope offline data; a placeholder before the first sign-in. */
export function currentUserId(): string {
  return getCurrentUser()?.userId ?? FALLBACK_USER;
}

export function rememberUser(user: CurrentUser | null): void {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
}

export function login(login: string, password: string): Promise<{ user: CurrentUser }> {
  return apiFetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ login, password }),
  });
}

export function fetchSessionUser(): Promise<{ user: CurrentUser | null }> {
  return apiFetch("/api/v1/auth/session", { cache: "no-store" });
}

export function signOutRequest(): Promise<unknown> {
  return apiFetch("/api/v1/auth/signout", { method: "POST" });
}

/** Sends the browser to the login page, returning here afterwards. */
export function redirectToLogin(): void {
  if (window.location.pathname === "/login") return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}
