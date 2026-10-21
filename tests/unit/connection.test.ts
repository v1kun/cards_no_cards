import { describe, expect, it, vi } from "vitest";

import { connection, connectionKind } from "@/lib/client/connection";

const base = { serverReachable: true, syncing: false, pending: 0 };

describe("connectionKind", () => {
  it("prefers browser offline over everything else", () => {
    expect(connectionKind(false, { ...base, syncing: true, pending: 3 })).toBe("offline");
  });

  it("reports an unreachable server", () => {
    expect(connectionKind(true, { ...base, serverReachable: false, pending: 2 })).toBe(
      "unreachable",
    );
  });

  it("reports syncing, then pending, then synced", () => {
    expect(connectionKind(true, { ...base, syncing: true, pending: 2 })).toBe("syncing");
    expect(connectionKind(true, { ...base, pending: 2 })).toBe("pending");
    expect(connectionKind(true, base)).toBe("synced");
    expect(connectionKind(true, { ...base, serverReachable: null })).toBe("synced");
  });
});

describe("connection store", () => {
  it("notifies only on real changes", () => {
    const listener = vi.fn();
    const unsubscribe = connection.subscribe(listener);
    connection.setPending(4);
    connection.setPending(4);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(connection.get().pending).toBe(4);
    unsubscribe();
    connection.setPending(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
