import { describe, expect, it } from "vitest";
import {
  createMessage,
  FromCommandCenterSchema,
  parseMessage,
  ToCommandCenterSchema,
  type FromCommandCenter,
  type ToCommandCenter,
} from "./messages";
import { WaveFileSchema } from "./scenario";

const position = { lat: 40, lon: 30 };

describe("createMessage / parseMessage", () => {
  it("round-trips a weapon registration", () => {
    const msg = createMessage<ToCommandCenter, "register">("register", {
      unitType: "weapon",
      key: "TDTS-0000-0000-0000",
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
    const parsed = parseMessage(ToCommandCenterSchema, JSON.stringify(msg));
    expect(parsed).toEqual({ ok: true, message: msg });
  });

  it("rejects invalid JSON", () => {
    expect(parseMessage(ToCommandCenterSchema, "{nope")).toEqual({
      ok: false,
      error: "invalid JSON",
    });
  });

  it("rejects a payload that doesn't match its unit type", () => {
    const msg = createMessage<ToCommandCenter, "register">("register", {
      unitType: "radar",
      key: "k",
      name: "Radar North",
      position,
      capabilities: { rangeM: 60_000 },
    });
    // A radar claiming weapon capabilities.
    const bad = { ...msg, payload: { ...msg.payload, capabilities: { ammo: 3 } } };
    expect(parseMessage(ToCommandCenterSchema, JSON.stringify(bad)).ok).toBe(false);
  });

  it("rejects messages sent on the wrong link", () => {
    // `fire` goes Command Center -> weapon, never the other way.
    const fire = createMessage<FromCommandCenter, "fire">("fire", { engagementId: "E-1" });
    expect(parseMessage(FromCommandCenterSchema, JSON.stringify(fire)).ok).toBe(true);
    expect(parseMessage(ToCommandCenterSchema, JSON.stringify(fire)).ok).toBe(false);
  });

  it("rejects inverted weapon ranges", () => {
    const msg = createMessage<FromCommandCenter, "setRanges">("setRanges", {
      minRangeM: 10_000,
      maxRangeM: 5_000,
    });
    expect(parseMessage(FromCommandCenterSchema, JSON.stringify(msg)).ok).toBe(false);
  });

  it("rejects out-of-range coordinates and likelihoods", () => {
    const msg = createMessage<ToCommandCenter, "tracks">("tracks", {
      scanAt: 1,
      tracks: [
        {
          radarTrackId: "R1-1",
          position: { lat: 95, lon: 30 },
          altitudeM: 300,
          speedMps: 50,
          headingDeg: 90,
          likelihood: 1.5,
          iff: "UNKNOWN",
          observedAt: 1,
        },
      ],
    });
    expect(parseMessage(ToCommandCenterSchema, JSON.stringify(msg)).ok).toBe(false);
  });
});

describe("WaveFileSchema", () => {
  const target = {
    id: "t1",
    kind: "drone",
    spawnAtS: 0,
    start: position,
    destination: { lat: 41, lon: 29 },
    speedMps: 50,
    altitudeM: 300,
  };

  it("accepts a valid wave", () => {
    expect(WaveFileSchema.safeParse({ name: "Wave 1", targets: [target] }).success).toBe(true);
  });

  it("rejects duplicate target ids and unknown kinds", () => {
    expect(WaveFileSchema.safeParse({ name: "W", targets: [target, target] }).success).toBe(false);
    expect(
      WaveFileSchema.safeParse({ name: "W", targets: [{ ...target, kind: "plane" }] }).success,
    ).toBe(false);
  });
});
