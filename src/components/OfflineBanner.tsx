"use client";

import { useEffect, useState } from "react";

/**
 * A fixed banner shown while the browser reports no network connection.
 *
 * Practice keeps working from the saved copy and answers sync later; other
 * pages (editing, imports, question generation) need the connection.
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
      Offline — practice still works and answers will sync later.
    </div>
  );
}
