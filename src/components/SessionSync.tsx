"use client";

import { useEffect } from "react";

import { fetchSessionUser, getCurrentUser, redirectToLogin, rememberUser } from "@/lib/client/user";

/**
 * Keeps the remembered user in step with the server session: signed out →
 * login page; a different account → remember it and reload so the offline
 * data of the right user is opened. Skipped offline (the cookie and the
 * remembered user stay as they are).
 */
export function SessionSync() {
  useEffect(() => {
    if (!navigator.onLine || window.location.pathname === "/login") return;
    fetchSessionUser()
      .then(({ user }) => {
        if (!user) {
          rememberUser(null);
          redirectToLogin();
          return;
        }
        const known = getCurrentUser();
        if (known?.userId !== user.userId || known.name !== user.name) {
          rememberUser(user);
          if (known?.userId !== user.userId) window.location.reload();
        }
      })
      .catch(() => undefined);
  }, []);
  return null;
}
