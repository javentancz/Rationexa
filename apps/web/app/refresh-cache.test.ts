import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRefreshSnapshots, readRefreshSnapshot, writeRefreshSnapshot } from "./refresh-cache";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("hard-refresh snapshots", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    vi.spyOn(Date, "now").mockReturnValue(10_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a fresh last-known-good value immediately", () => {
    writeRefreshSnapshot("workspace", { decisions: 2 });

    expect(readRefreshSnapshot("workspace", 5_000)).toEqual({
      savedAt: 10_000,
      value: { decisions: 2 },
    });
  });

  it("removes an expired value instead of rendering stale private data", () => {
    writeRefreshSnapshot("workspace", { decisions: 2 });
    vi.spyOn(Date, "now").mockReturnValue(20_001);

    expect(readRefreshSnapshot("workspace", 10_000)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("clears only Rationexa snapshots", () => {
    storage.setItem("unrelated", "keep me");
    writeRefreshSnapshot("workspace", { decisions: 2 });
    writeRefreshSnapshot("account", { name: "Pilot" });

    clearRefreshSnapshots();

    expect(storage.getItem("unrelated")).toBe("keep me");
    expect(storage.length).toBe(1);
  });
});
