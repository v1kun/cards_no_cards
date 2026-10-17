"use client";

import { useEffect, useState } from "react";

/**
 * A fixed banner shown while the browser reports no network connection.
 *
 * This gives the whole app a clear, consistent signal that saves and syncs
 * will fail, complementing the per-request network errors surfaced by the API
 * client.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      You are offline. Changes can’t be saved until the connection returns.
    </div>
  );
}
