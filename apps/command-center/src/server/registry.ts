// Unit registration (DESIGN.md §3). Pure logic: connections are plain ids, time
// is passed in, and the caller does the sockets and saving.

import {
  distanceM,
  HEARTBEAT_TIMEOUT_MS,
  isValidKeyFormat,
  MANUAL_MATCH_TOLERANCE_M,
  type PayloadOf,
  type RejectReason,
  type ToCommandCenter,
} from "@tdts/shared";
import type { UnitRecord, UnitView } from "../protocol";
import type { KeyStore } from "./keys";

export type RegisterRequest = PayloadOf<ToCommandCenter, "register">;

export type RegisterResult =
  | { kind: "registered"; unitId: string }
  | { kind: "pending"; distanceM: number }
  | { kind: "rejected"; reason: RejectReason; detail?: string };

type Connection =
  | { kind: "new"; lastSeen: number }
  | { kind: "registered"; key: string; unitId: string; lastSeen: number }
  | { kind: "pending"; key: string; request: RegisterRequest; distanceM: number; lastSeen: number };

const UNIT_ID_PREFIX = { radar: "RDR", weapon: "WPN" } as const;

export class Registry {
  private readonly units = new Map<string, UnitRecord>();
  private readonly connections = new Map<string, Connection>();

  constructor(
    private readonly keys: KeyStore,
    units: readonly UnitRecord[] = [],
  ) {
    for (const u of units) this.units.set(u.unitId, u);
  }

  // ------------------------------------------------------------- connections

  connect(connId: string, now: number): void {
    this.connections.set(connId, { kind: "new", lastSeen: now });
  }

  disconnect(connId: string): void {
    this.connections.delete(connId);
  }

  heartbeat(connId: string, now: number): void {
    const conn = this.connections.get(connId);
    if (conn) conn.lastSeen = now;
  }

  /** Connections that missed heartbeats for HEARTBEAT_TIMEOUT_MS; the caller closes them. */
  timedOut(now: number): string[] {
    return [...this.connections]
      .filter(([, c]) => now - c.lastSeen > HEARTBEAT_TIMEOUT_MS)
      .map(([id]) => id);
  }

  /** The registered unit on this connection, if any (pending units don't count). */
  unitOn(connId: string): string | null {
    const conn = this.connections.get(connId);
    return conn?.kind === "registered" ? conn.unitId : null;
  }

  /** The connection currently using `key`, if any. */
  connectionWithKey(key: string): string | null {
    for (const [id, c] of this.connections) if (c.kind !== "new" && c.key === key) return id;
    return null;
  }

  // ------------------------------------------------------------- registration

  register(connId: string, req: RegisterRequest, now: number): RegisterResult {
    const conn = this.connections.get(connId);
    if (!conn) throw new Error(`unknown connection ${connId}`);
    if (conn.kind !== "new") {
      return { kind: "rejected", reason: "ALREADY_CONNECTED", detail: "already registered" };
    }

    const key = isValidKeyFormat(req.key) ? this.keys.get(req.key) : undefined;
    if (!key) return { kind: "rejected", reason: "INVALID_KEY" };
    if (key.status === "REVOKED") return { kind: "rejected", reason: "REVOKED" };
    if (key.unitType !== req.unitType) {
      return {
        kind: "rejected",
        reason: "TYPE_MISMATCH",
        detail: `key is for a ${key.unitType}`,
      };
    }
    if (this.connectionWithKey(key.key)) return { kind: "rejected", reason: "ALREADY_CONNECTED" };

    // Manual keys: the unit must be where the operator said it would be. Once
    // a unit is accepted (directly or by approval), its accepted position is
    // the reference, so an approved unit can reconnect from the same spot.
    const reference = key.unitId
      ? this.units.get(key.unitId)?.position
      : key.mode === "manual"
        ? key.expectedPosition
        : undefined;
    if (key.mode === "manual" && reference) {
      const off = distanceM(reference, req.position);
      if (off > MANUAL_MATCH_TOLERANCE_M) {
        this.connections.set(connId, {
          kind: "pending",
          key: key.key,
          request: req,
          distanceM: off,
          lastSeen: now,
        });
        return { kind: "pending", distanceM: off };
      }
    }

    const unitId = this.bind(key.key, req, now);
    this.connections.set(connId, { kind: "registered", key: key.key, unitId, lastSeen: now });
    return { kind: "registered", unitId };
  }

  /**
   * Creates (or, for a key that is already bound, updates) the unit record.
   * A reconnecting unit keeps its id; its reported name, position and
   * capabilities replace the saved ones.
   */
  private bind(key: string, req: RegisterRequest, now: number): string {
    const existing = this.keys.get(key)?.unitId;
    const unitId = existing ?? this.nextUnitId(req.unitType);
    const base = {
      unitId,
      key,
      name: req.name,
      position: req.position,
      registeredAt: this.units.get(unitId)?.registeredAt ?? now,
    };
    this.units.set(
      unitId,
      req.unitType === "radar"
        ? { ...base, unitType: "radar", capabilities: req.capabilities }
        : { ...base, unitType: "weapon", capabilities: req.capabilities },
    );
    if (!existing) this.keys.bind(key, unitId);
    return unitId;
  }

  private nextUnitId(unitType: keyof typeof UNIT_ID_PREFIX): string {
    const prefix = UNIT_ID_PREFIX[unitType];
    for (let n = 1; ; n++) {
      const id = `${prefix}-${String(n).padStart(2, "0")}`;
      if (!this.units.has(id)) return id;
    }
  }

  // ------------------------------------------------------------- operator decisions

  /**
   * The operator accepts a pending unit: it is registered as if it had been
   * in the right place. Returns its connection and new unit id.
   */
  approve(key: string, now: number): { connId: string; unitId: string } {
    const connId = this.connectionWithKey(key);
    const conn = connId ? this.connections.get(connId) : undefined;
    if (!connId || conn?.kind !== "pending") throw new Error(`no pending unit with key ${key}`);
    const unitId = this.bind(key, conn.request, now);
    this.connections.set(connId, { kind: "registered", key, unitId, lastSeen: conn.lastSeen });
    return { connId, unitId };
  }

  /**
   * The operator turns a pending unit away. Its key stays ISSUED, so the
   * right device can still use it. Returns the connection to close.
   */
  reject(key: string): string {
    const connId = this.connectionWithKey(key);
    if (!connId || this.connections.get(connId)?.kind !== "pending") {
      throw new Error(`no pending unit with key ${key}`);
    }
    this.connections.delete(connId);
    return connId;
  }

  // ------------------------------------------------------------- keys going away

  /**
   * The key was deleted: forget its unit. Returns the connection to close,
   * if a unit was connected with it.
   */
  forgetKey(key: string): string | null {
    const connId = this.connectionWithKey(key);
    if (connId) this.connections.delete(connId);
    for (const [id, u] of this.units) if (u.key === key) this.units.delete(id);
    return connId;
  }

  // ------------------------------------------------------------- read model

  records(): UnitRecord[] {
    return [...this.units.values()];
  }

  /** Registered units (online or offline) and pending ones, sorted by id. */
  view(): UnitView[] {
    const online = new Set<string>();
    const pending: UnitView[] = [];
    for (const c of this.connections.values()) {
      if (c.kind === "registered") online.add(c.unitId);
      if (c.kind === "pending") {
        const r = c.request;
        const base = {
          unitId: null,
          key: c.key,
          name: r.name,
          position: r.position,
          status: "PENDING" as const,
          distanceM: c.distanceM,
        };
        pending.push(
          r.unitType === "radar"
            ? { ...base, unitType: "radar", capabilities: r.capabilities }
            : { ...base, unitType: "weapon", capabilities: r.capabilities },
        );
      }
    }
    const registered: UnitView[] = [...this.units.values()]
      .sort((a, b) => a.unitId.localeCompare(b.unitId))
      .map((u) => ({
        ...u,
        status: online.has(u.unitId) ? "ONLINE" : "OFFLINE",
      }));
    return [...registered, ...pending];
  }
}
