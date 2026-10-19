import {
  destination,
  generateDeviceKeys,
  HEARTBEAT_TIMEOUT_MS,
  signChallenge,
  type DeviceKeys,
} from "@tdts/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { KeyStore } from "./keys";
import { Registry, type RegisterRequest, type RegisterResult } from "./registry";

const T0 = 1_700_000_000_000;
const here = { lat: 47.4, lon: 8.5 };

/** Two devices: `device` is the legitimate one, `impostor` copies its keys. */
let device: DeviceKeys;
let impostor: DeviceKeys;
beforeAll(async () => {
  device = await generateDeviceKeys();
  impostor = await generateDeviceKeys();
});

type Request = Omit<RegisterRequest, "publicKey">;

const radar = (key: string, position = here): Request => ({
  unitType: "radar",
  key,
  name: "Radar North",
  position,
  capabilities: { rangeM: 60_000 },
});
const weapon = (key: string, position = here): Request => ({
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
const withKey = (req: Request, d: DeviceKeys): RegisterRequest =>
  ({ ...req, publicKey: d.publicKey }) as RegisterRequest;

function setup() {
  const keys = new KeyStore();
  const registry = new Registry(keys);
  let n = 0;
  /**
   * Opens a connection and runs both registration steps as `as` (default: the
   * legitimate device), signing the challenge like a real unit would.
   */
  const connectAndRegister = async (
    req: Request,
    { as = device, now = T0 }: { as?: DeviceKeys; now?: number } = {},
  ): Promise<{ conn: string; result: RegisterResult }> => {
    const conn = `c${++n}`;
    registry.connect(conn, now);
    const first = registry.register(conn, withKey(req, as), now);
    if (first.kind === "rejected") return { conn, result: first };
    const signature = await signChallenge(as.privateKey, first.nonce, req.key);
    return { conn, result: await registry.answerChallenge(conn, signature, now) };
  };
  return { keys, registry, connectAndRegister };
}

/** Step 1 only, for tests that look at the challenge itself. */
function challenge(registry: Registry, conn: string, req: Request, d: DeviceKeys) {
  registry.connect(conn, T0);
  const first = registry.register(conn, withKey(req, d), T0);
  if (first.kind !== "challenge") throw new Error(`expected a challenge, got ${first.kind}`);
  return first.nonce;
}

describe("automatic keys", () => {
  it("register a unit, bind the key and show it online", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);

    const { conn, result } = await connectAndRegister(radar(k.key));
    expect(result).toEqual({ kind: "registered", unitId: "RDR-01" });
    expect(keys.get(k.key)).toMatchObject({ status: "BOUND", unitId: "RDR-01" });
    expect(registry.unitOn(conn)).toBe("RDR-01");
    expect(registry.records()[0]).toMatchObject({ publicKey: device.publicKey });
    expect(registry.view()).toEqual([
      expect.objectContaining({
        unitId: "RDR-01",
        name: "Radar North",
        status: "ONLINE",
        deviceId: expect.stringMatching(/^[0-9a-f]{16}$/),
      }),
    ]);
  });

  it("number radars and weapons separately", async () => {
    const { keys, connectAndRegister } = setup();
    const results = [];
    for (const req of [
      radar(keys.generate({ mode: "auto", unitType: "radar" }, T0).key),
      weapon(keys.generate({ mode: "auto", unitType: "weapon" }, T0).key),
      radar(keys.generate({ mode: "auto", unitType: "radar" }, T0).key),
    ]) {
      results.push((await connectAndRegister(req)).result);
    }
    expect(results).toEqual([
      { kind: "registered", unitId: "RDR-01" },
      { kind: "registered", unitId: "WPN-01" },
      { kind: "registered", unitId: "RDR-02" },
    ]);
  });
});

describe("device keys", () => {
  it("send a fresh challenge before anything is decided", () => {
    const { keys, registry } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    expect(challenge(registry, "c", radar(k.key), device)).toEqual(expect.any(String));
    expect(keys.get(k.key)!.status).toBe("ISSUED");
    expect(registry.unitOn("c")).toBeNull();
  });

  it("reject a signature that doesn't match the presented public key", async () => {
    const { keys, registry } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const nonce = challenge(registry, "c", radar(k.key), device);
    // Signed by someone else's private key.
    const forged = await signChallenge(impostor.privateKey, nonce, k.key);
    expect(await registry.answerChallenge("c", forged, T0)).toMatchObject({
      kind: "rejected",
      reason: "BAD_SIGNATURE",
    });
    expect(keys.get(k.key)!.status).toBe("ISSUED");
  });

  it("refuse a copied key from another device once it is bound", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = await connectAndRegister(radar(k.key));
    registry.disconnect(conn); // the real radar goes offline...

    // ...and someone with the copied registration key tries to take its place.
    const attempt = await connectAndRegister(radar(k.key), { as: impostor });
    expect(attempt.result).toMatchObject({ kind: "rejected", reason: "DEVICE_MISMATCH" });

    // The real device still gets back in.
    expect((await connectAndRegister(radar(k.key))).result).toEqual({
      kind: "registered",
      unitId: "RDR-01",
    });
  });

  it("let a unit saved before device keys adopt the first device that proves itself", async () => {
    const keys = new KeyStore();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    keys.bind(k.key, "RDR-01");
    const legacy = {
      unitId: "RDR-01",
      key: k.key,
      unitType: "radar" as const,
      name: "Old radar",
      position: here,
      capabilities: { rangeM: 60_000 },
      registeredAt: T0,
    };
    const registry = new Registry(keys, [legacy]);
    const nonce = challenge(registry, "c", radar(k.key), device);
    const sig = await signChallenge(device.privateKey, nonce, k.key);
    expect(await registry.answerChallenge("c", sig, T0)).toEqual({
      kind: "registered",
      unitId: "RDR-01",
    });
    expect(registry.records()[0]!.publicKey).toBe(device.publicKey);
  });

  it("time out a connection that never answers its challenge, heartbeats or not", () => {
    const { keys, registry } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    challenge(registry, "c", radar(k.key), device);
    registry.heartbeat("c", T0 + HEARTBEAT_TIMEOUT_MS);
    expect(registry.timedOut(T0 + HEARTBEAT_TIMEOUT_MS + 1)).toEqual(["c"]);
  });

  it("drop the answer if the key was deleted while verifying", async () => {
    const { keys, registry } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const nonce = challenge(registry, "c", radar(k.key), device);
    const sig = await signChallenge(device.privateKey, nonce, k.key);
    const answer = registry.answerChallenge("c", sig, T0);
    registry.forgetKey(k.key);
    expect(await answer).toMatchObject({ kind: "rejected" });
    expect(registry.view()).toEqual([]);
  });
});

describe("manual keys", () => {
  const manualWeapon = (keys: KeyStore) =>
    keys.generate(
      { mode: "manual", unitType: "weapon", name: "Battery Alpha", expectedPosition: here },
      T0,
    );

  it("register a unit within 2 km of the expected position", async () => {
    const { keys, connectAndRegister } = setup();
    const k = manualWeapon(keys);
    const nearby = destination(here, 45, 1_500);
    expect((await connectAndRegister(weapon(k.key, nearby))).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("hold a unit further away as pending, without binding the key", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = manualWeapon(keys);
    const { conn, result } = await connectAndRegister(weapon(k.key, destination(here, 45, 5_000)));

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
  it("reject unknown, malformed and wrong-type keys", async () => {
    const { keys, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    expect((await connectAndRegister(radar("TDTS-0000-0000-0000"))).result).toMatchObject({
      kind: "rejected",
      reason: "INVALID_KEY",
    });
    expect((await connectAndRegister(radar("hello"))).result).toMatchObject({
      reason: "INVALID_KEY",
    });
    expect((await connectAndRegister(weapon(k.key))).result).toMatchObject({
      reason: "TYPE_MISMATCH",
    });
  });

  it("reject a second connection with a key that is in use", async () => {
    const { keys, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    await connectAndRegister(radar(k.key));
    expect((await connectAndRegister(radar(k.key))).result).toMatchObject({
      reason: "ALREADY_CONNECTED",
    });
  });

  it("reject registering twice on one connection", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = await connectAndRegister(radar(k.key));
    expect(registry.register(conn, withKey(radar(k.key), device), T0)).toMatchObject({
      kind: "rejected",
    });
  });
});

describe("reconnecting", () => {
  it("keeps the unit id and takes the newly reported details", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = await connectAndRegister(radar(k.key));

    registry.disconnect(conn);
    expect(registry.view()[0]).toMatchObject({ unitId: "RDR-01", status: "OFFLINE" });

    const moved = destination(here, 0, 300);
    const again = await connectAndRegister(
      { ...radar(k.key, moved), name: "Radar N2" },
      { now: T0 + 5_000 },
    );
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

  it("survives a restart through saved records, device binding included", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    await connectAndRegister(radar(k.key));

    const restarted = new Registry(new KeyStore(keys.list()), registry.records());
    expect(restarted.view()).toEqual([
      expect.objectContaining({ unitId: "RDR-01", status: "OFFLINE" }),
    ]);
    restarted.connect("x", T0);
    expect(restarted.register("x", withKey(radar(k.key), impostor), T0)).toMatchObject({
      reason: "DEVICE_MISMATCH",
    });
  });
});

describe("heartbeats", () => {
  it("time out connections that go quiet, including unregistered ones", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = await connectAndRegister(radar(k.key));
    registry.connect("silent", T0);

    registry.heartbeat(conn, T0 + HEARTBEAT_TIMEOUT_MS);
    expect(registry.timedOut(T0 + HEARTBEAT_TIMEOUT_MS + 1)).toEqual(["silent"]);
  });
});

describe("deleting a key", () => {
  it("forgets its unit and returns the connection to close", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    const { conn } = await connectAndRegister(radar(k.key));

    expect(registry.forgetKey(k.key)).toBe(conn);
    expect(registry.view()).toEqual([]);
    expect(registry.forgetKey(k.key)).toBeNull();
  });

  it("also drops a pending unit", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate(
      { mode: "manual", unitType: "radar", name: "N", expectedPosition: here },
      T0,
    );
    const { conn } = await connectAndRegister(radar(k.key, destination(here, 0, 9_000)));
    expect(registry.forgetKey(k.key)).toBe(conn);
    expect(registry.view()).toEqual([]);
  });
});

describe("operator decisions on pending units", () => {
  const far = destination(here, 90, 6_000);
  const pendingWeapon = async () => {
    const s = setup();
    const k = s.keys.generate(
      { mode: "manual", unitType: "weapon", name: "Battery Alpha", expectedPosition: here },
      T0,
    );
    const { conn } = await s.connectAndRegister(weapon(k.key, far));
    return { ...s, key: k.key, conn };
  };

  it("approving registers the unit where it actually is, with its device", async () => {
    const { keys, registry, key, conn } = await pendingWeapon();
    expect(registry.approve(key, T0 + 1_000)).toEqual({ connId: conn, unitId: "WPN-01" });
    expect(registry.unitOn(conn)).toBe("WPN-01");
    expect(keys.get(key)).toMatchObject({ status: "BOUND", unitId: "WPN-01" });
    expect(registry.records()[0]).toMatchObject({ publicKey: device.publicKey });
    expect(registry.view()).toEqual([
      expect.objectContaining({ unitId: "WPN-01", status: "ONLINE", position: far }),
    ]);
  });

  it("an approved unit reconnects from the same spot without approval", async () => {
    const { registry, key, conn, connectAndRegister } = await pendingWeapon();
    registry.approve(key, T0);
    registry.disconnect(conn);
    expect((await connectAndRegister(weapon(key, far))).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("but moving 2 km+ from where it was approved makes it pending again", async () => {
    const { registry, key, conn, connectAndRegister } = await pendingWeapon();
    registry.approve(key, T0);
    registry.disconnect(conn);
    expect(
      (await connectAndRegister(weapon(key, destination(far, 0, 3_000)))).result,
    ).toMatchObject({ kind: "pending" });
  });

  it("rejecting drops the connection and keeps the key usable", async () => {
    const { keys, registry, key, conn, connectAndRegister } = await pendingWeapon();
    expect(registry.reject(key)).toBe(conn);
    expect(registry.view()).toEqual([]);
    expect(keys.get(key)!.status).toBe("ISSUED");
    // The right device, in the right place, can still register with it.
    expect((await connectAndRegister(weapon(key, here))).result).toEqual({
      kind: "registered",
      unitId: "WPN-01",
    });
  });

  it("refuses to approve or reject a key with no pending unit", async () => {
    const { keys, registry, connectAndRegister } = setup();
    const k = keys.generate({ mode: "auto", unitType: "radar" }, T0);
    expect(() => registry.approve(k.key, T0)).toThrow("no pending unit");
    await connectAndRegister(radar(k.key));
    expect(() => registry.reject(k.key)).toThrow("no pending unit");
  });
});
