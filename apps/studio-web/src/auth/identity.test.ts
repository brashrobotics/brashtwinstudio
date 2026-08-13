import { describe, expect, it } from "vitest";
import { LocalIdentityAdapter, type StudioIdentity } from "./identity";

describe("local identity adapter", () => {
  it("falls back safely and persists normalized development identity", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const adapter = new LocalIdentityAdapter(storage);
    expect(adapter.load().subject).toBe("local-operator");

    const identity: StudioIdentity = {
      subject: "operator-7",
      displayName: "Ada Operator",
      roles: ["MAP_APPROVER"],
      source: "local-development",
    };
    adapter.save(identity);
    expect(adapter.load()).toEqual(identity);
  });
});
