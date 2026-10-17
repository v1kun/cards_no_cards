"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in the browser (production only).
 *
 * Renders nothing. Registration failures are swallowed because the app is
 * fully functional without the service worker — it only adds static-asset
 * caching and installability.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* no-op: the app works without the service worker */
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
