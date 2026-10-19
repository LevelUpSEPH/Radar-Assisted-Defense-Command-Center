import { describe, expect, it } from "vitest";
import { generateKey, isValidKeyFormat } from "./keys";

describe("registration keys", () => {
  it("generates keys in the TDTS-XXXX-XXXX-XXXX format", () => {
    for (let i = 0; i < 100; i++) expect(isValidKeyFormat(generateKey())).toBe(true);
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 1_000 }, generateKey));
    expect(keys.size).toBe(1_000);
  });

  it.each([
    "",
    "TDTS-ABCD-EFGH",
    "tdts-0000-0000-0000",
    "TDTS-0000-0000-000I",
    "XXXX-0000-0000-0000",
  ])("rejects %s", (key) => expect(isValidKeyFormat(key)).toBe(false));
});
