// Registration keys (DESIGN.md §3). Pure logic; persistence is done by the caller.

import { generateKey } from "@tdts/shared";
import type { KeyRecord, KeyRequest } from "../protocol";

export class KeyStore {
  private readonly keys = new Map<string, KeyRecord>();

  constructor(records: readonly KeyRecord[] = []) {
    for (const r of records) this.keys.set(r.key, r);
  }

  /** Issues a new key for the request. */
  generate(request: KeyRequest, now: number): KeyRecord {
    let key = generateKey();
    while (this.keys.has(key)) key = generateKey(); // 60 random bits; practically never loops

    const record: KeyRecord =
      request.mode === "manual"
        ? {
            key,
            unitType: request.unitType,
            mode: "manual",
            name: request.name.trim(),
            expectedPosition: request.expectedPosition,
            status: "ISSUED",
            createdAt: now,
          }
        : { key, unitType: request.unitType, mode: "auto", status: "ISSUED", createdAt: now };

    this.keys.set(key, record);
    return record;
  }

  /** Marks the key as used by `unitId`. */
  bind(key: string, unitId: string): void {
    const record = this.keys.get(key);
    if (!record) throw new Error(`unknown key ${key}`);
    this.keys.set(key, { ...record, status: "BOUND", unitId });
  }

  /** Removes the key for good; a unit presenting it later gets INVALID_KEY. */
  delete(key: string): boolean {
    return this.keys.delete(key);
  }

  get(key: string): KeyRecord | undefined {
    return this.keys.get(key);
  }

  /** Newest first. */
  list(): KeyRecord[] {
    return [...this.keys.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}
