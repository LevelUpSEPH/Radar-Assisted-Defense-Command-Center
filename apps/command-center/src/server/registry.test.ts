import { destination, HEARTBEAT_TIMEOUT_MS } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { KeyStore } from "./keys";
import { Registry, type RegisterRequest } from "./registry";

const T0 = 1_700_000_000_000;
const here = { lat: 47.4, lon: 8.5 };

const radar = (key: string, position = here): RegisterRequest => ({
  unitType: "radar",
  key,
  name: "Radar North",
  position,
  capabilities: { rangeM: 60_000 },
});
const weapon = (key: string, position = here): RegisterRequest => ({
  unitType: "weapon",
  key,
  name: "Battery Alpha",
  position,
  capabilities: {
    minRangeM: 2_000,
    maxRangeM: 15_000,
    ammo: 20,
    prepareTimeS: 8,
    reloadTimeS: 12,
    shellSpeedMps: 300,
  },
});

function setup() {
  const keys = new KeyStore();
  const registry = new Registry(keys);
  let n = 0;
  /** Opens a new connection and registers on it. */
  const connectAndRegister = (req: RegisterRequest, now = T0) => {
    const conn = `c${++n}`;
    registry.connect(conn, now);
    return { conn, result: registry.register(conn, req, now) };
  };
  return { keys, registry, connectAndRegister };
}

describe("automatic keys", () => {
  it("register a unit, bind the key and show it online", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);

    const { conn, result } = connectAndRegister(radar(k.key));
    expect(result).toEqual({ kind: "registered", unitId: "RDR-01" });
    expect(keys.get(k.key)).toMatchObject({ status: "BOUND", unitId: "RDR-01" });
    expect(registry.unitOn(conn)).toBe("RDR-01");
    expect(registry.view()).toEqual([
      expect.objectContaining({ unitId: "RDR-01", name: "Radar North", status: "ONLINE" }),
    ]);
  });

  it("number radars and weapons separately", () => {
    const { keys, connectAndRegister } = setup();
    const ids = [
      radar(keys.generate({ mode: "auto", unitType: "radar" }, T0).key),
      weapon(keys.generate({ mode: "auto", unitType: "weapon" }, T0).key),
      radar(keys.generate({ mode: "auto", unitType: "radar" }, T0).key),
    ].map((req) => connectAndRegister(req).result);
    expect(ids).toEqual([
      { kind: "registered", unitId: "RDR-01" },
      { kind: "registered", unitId: "WPN-01" },
      { kind: "registered", unitId: "RDR-02" },
    ]);
  });
});

describe("manual keys", () => {
  const manualWeapon = (keys: KeyStore) =>
    keys.generate(
      { mode: "manual", unitType: "weapon", name: "Battery Alpha", expectedPosition: here },
      T0,
    );

  it("register a unit within 2 km of the expected position", () => {
    const { keys, connectAndRegister } = setup();
    const k = manualWeapon(keys);
    const nearby = destination(here, 45, 1_500);
    expect(connectAndRegister(weapon(k.key, nearby)).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("hold a unit further away as pending, without binding the key", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = manualWeapon(keys);
    const { conn, result } = connectAndRegister(weapon(k.key, destination(here, 45, 5_000)));

    expect(result).toMatchObject({ kind: "pending" });
    if (result.kind === "pending") expect(result.distanceM).toBeCloseTo(5_000, 0);
    expect(keys.get(k.key)!.status).toBe("ISSUED");
    expect(registry.unitOn(conn)).toBeNull();
    expect(registry.view()).toEqual([
      expect.objectContaining({ unitId: null, status: "PENDING", key: k.key }),
    ]);
  });
});

describe("rejections", () => {
  it("reject unknown, malformed and wrong-type keys", () => {
    const { keys, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    expect(connectAndRegister(radar("TDTS-0000-0000-0000")).result).toMatchObject({
      kind: "rejected",
      reason: "INVALID_KEY",
    });
    expect(connectAndRegister(radar("hello")).result).toMatchObject({ reason: "INVALID_KEY" });
    expect(connectAndRegister(weapon(k.key)).result).toMatchObject({ reason: "TYPE_MISMATCH" });
  });

  it("reject a second connection with a key that is in use", () => {
    const { keys, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    connectAndRegister(radar(k.key));
    expect(connectAndRegister(radar(k.key)).result).toMatchObject({
      reason: "ALREADY_CONNECTED",
    });
  });

  it("reject registering twice on one connection", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = connectAndRegister(radar(k.key));
    expect(registry.register(conn, radar(k.key), T0)).toMatchObject({ kind: "rejected" });
  });
});

describe("reconnecting", () => {
  it("keeps the unit id and takes the newly reported details", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = connectAndRegister(radar(k.key));

    registry.disconnect(conn);
    expect(registry.view()[0]).toMatchObject({ unitId: "RDR-01", status: "OFFLINE" });

    const moved = destination(here, 0, 300);
    const again = connectAndRegister({ ...radar(k.key, moved), name: "Radar N2" }, T0 + 5_000);
    expect(again.result).toEqual({ kind: "registered", unitId: "RDR-01" });
    expect(registry.records()).toEqual([
      expect.objectContaining({
        unitId: "RDR-01",
        name: "Radar N2",
        position: moved,
        registeredAt: T0,
      }),
    ]);
  });

  it("survives a restart through saved records", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    connectAndRegister(radar(k.key));

    const restartedKeys = new KeyStore(keys.list());
    const restarted = new Registry(restartedKeys, registry.records());
    expect(restarted.view()).toEqual([
      expect.objectContaining({ unitId: "RDR-01", status: "OFFLINE" }),
    ]);
    restarted.connect("x", T0);
    expect(restarted.register("x", radar(k.key), T0)).toEqual({
      kind: "registered",
      unitId: "RDR-01",
    });
  });
});

describe("heartbeats", () => {
  it("time out connections that go quiet, including unregistered ones", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = connectAndRegister(radar(k.key));
    registry.connect("silent", T0);

    registry.heartbeat(conn, T0 + HEARTBEAT_TIMEOUT_MS);
    expect(registry.timedOut(T0 + HEARTBEAT_TIMEOUT_MS + 1)).toEqual(["silent"]);
  });
});

describe("deleting a key", () => {
  it("forgets its unit and returns the connection to close", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = connectAndRegister(radar(k.key));

    expect(registry.forgetKey(k.key)).toBe(conn);
    expect(registry.view()).toEqual([]);
    expect(registry.forgetKey(k.key)).toBeNull();
  });

  it("also drops a pending unit", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate(
      { mode: "manual", unitType: "radar", name: "N", expectedPosition: here },
      T0,
    );
    const { conn } = connectAndRegister(radar(k.key, destination(here, 0, 9_000)));
    expect(registry.forgetKey(k.key)).toBe(conn);
    expect(registry.view()).toEqual([]);
  });
});

describe("operator decisions on pending units", () => {
  const far = destination(here, 90, 6_000);
  const pendingWeapon = () => {
    const s = setup();
    const k = s.keys.generate(
      { mode: "manual", unitType: "weapon", name: "Battery Alpha", expectedPosition: here },
      T0,
    );
    const { conn } = s.connectAndRegister(weapon(k.key, far));
    return { ...s, key: k.key, conn };
  };

  it("approving registers the unit where it actually is", () => {
    const { keys, registry, key, conn } = pendingWeapon();
    expect(registry.approve(key, T0 + 1_000)).toEqual({ connId: conn, unitId: "WPN-01" });
    expect(registry.unitOn(conn)).toBe("WPN-01");
    expect(keys.get(key)).toMatchObject({ status: "BOUND", unitId: "WPN-01" });
    expect(registry.view()).toEqual([
      expect.objectContaining({ unitId: "WPN-01", status: "ONLINE", position: far }),
    ]);
  });

  it("an approved unit reconnects from the same spot without approval", () => {
    const { registry, key, conn, connectAndRegister } = pendingWeapon();
    registry.approve(key, T0);
    registry.disconnect(conn);
    expect(connectAndRegister(weapon(key, far)).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("but moving 2 km+ from where it was approved makes it pending again", () => {
    const { registry, key, conn, connectAndRegister } = pendingWeapon();
    registry.approve(key, T0);
    registry.disconnect(conn);
    expect(connectAndRegister(weapon(key, destination(far, 0, 3_000))).result).toMatchObject({
      kind: "pending",
    });
  });

  it("rejecting drops the connection and keeps the key usable", () => {
    const { keys, registry, key, conn, connectAndRegister } = pendingWeapon();
    expect(registry.reject(key)).toBe(conn);
    expect(registry.view()).toEqual([]);
    expect(keys.get(key)!.status).toBe("ISSUED");
    // The right device, in the right place, can still register with it.
    expect(connectAndRegister(weapon(key, here)).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("refuses to approve or reject a key with no pending unit", () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    expect(() => registry.approve(k.key, T0)).toThrow("no pending unit");
    connectAndRegister(radar(k.key));
    expect(() => registry.reject(k.key)).toThrow("no pending unit");
  });
});
