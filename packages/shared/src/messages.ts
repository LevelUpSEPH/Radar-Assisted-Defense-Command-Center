// Network protocol (DESIGN.md §9). Every message is an envelope
// { type, msgId, ts, payload }, validated with zod on receipt.
//
// Messages are grouped by the link they travel on, so each endpoint only
// accepts what it should receive:
//   ToCommandCenter / FromCommandCenter   radar & weapon  <-> Command Center
//   ToWorldSim      / FromWorldSim        radar           <-> World Simulator
//
// Only radars talk to the World Simulator: it is what they "see".

import { z } from "zod";

// ---------------------------------------------------------------- primitives

export const LatLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const Meters = z.number().nonnegative();
const Seconds = z.number().nonnegative();
const EpochMs = z.number().int().nonnegative();
const Bearing = z.number().min(0).lt(360);
const Id = z.string().min(1);

export const UnitTypeSchema = z.enum(["radar", "weapon"]);
export type UnitType = z.infer<typeof UnitTypeSchema>;

/** What a radar (or its operator) says a track is. */
export const IffSchema = z.enum(["UNKNOWN", "FRIENDLY", "ENEMY"]);
export type Iff = z.infer<typeof IffSchema>;

export const WeaponStateSchema = z.enum([
  "IDLE",
  "PREPARING",
  "READY",
  "FIRING",
  "RELOADING",
  "EMPTY",
]);
export type WeaponState = z.infer<typeof WeaponStateSchema>;

/** States reported to operators as BUSY. */
export const BUSY_STATES: readonly WeaponState[] = ["PREPARING", "FIRING", "RELOADING"];

export const RejectReasonSchema = z.enum([
  "INVALID_KEY",
  "REVOKED",
  "TYPE_MISMATCH",
  "ALREADY_CONNECTED",
  "REJECTED_BY_OPERATOR",
  /** The key is bound to a different device (another public key). */
  "DEVICE_MISMATCH",
  /** The challenge signature didn't verify. */
  "BAD_SIGNATURE",
]);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

const RangesSchema = z
  .object({ minRangeM: Meters, maxRangeM: Meters })
  .refine((r) => r.minRangeM < r.maxRangeM, { message: "minRangeM must be below maxRangeM" });

export const WeaponCapabilitiesSchema = z
  .object({
    minRangeM: Meters,
    maxRangeM: Meters,
    ammo: z.number().int().nonnegative(),
    prepareTimeS: Seconds,
    reloadTimeS: Seconds,
    shellSpeedMps: z.number().positive(),
  })
  .refine((w) => w.minRangeM < w.maxRangeM, { message: "minRangeM must be below maxRangeM" });
export type WeaponCapabilities = z.infer<typeof WeaponCapabilitiesSchema>;

export const RadarCapabilitiesSchema = z.object({
  rangeM: z.number().positive(),
});
export type RadarCapabilities = z.infer<typeof RadarCapabilitiesSchema>;

/** A radar's own view of one object it sees. */
export const RadarTrackSchema = z.object({
  radarTrackId: Id,
  position: LatLonSchema,
  altitudeM: z.number(),
  speedMps: Meters,
  headingDeg: Bearing,
  /** 0..1, how likely this is a flying vehicle (vs. a bird or clutter). */
  likelihood: z.number().min(0).max(1),
  /** The radar's current report: IFF answer or its operator's marking. */
  iff: IffSchema,
  observedAt: EpochMs,
});
export type RadarTrack = z.infer<typeof RadarTrackSchema>;

/** A weapon's state as it reports it (sent on every change and every heartbeat). */
export const WeaponStatusSchema = z.object({
  state: WeaponStateSchema,
  ammo: z.number().int().nonnegative(),
  minRangeM: Meters,
  maxRangeM: Meters,
  engagementId: Id.nullable(),
  /** When the current PREPARING / RELOADING phase ends, for progress bars. */
  stateUntil: EpochMs.nullable(),
});
export type WeaponStatus = z.infer<typeof WeaponStatusSchema>;

/** The Command Center's fused track, as sent to a weapon. */
export const SystemTrackSchema = z.object({
  trackId: Id,
  position: LatLonSchema,
  altitudeM: z.number(),
  speedMps: Meters,
  headingDeg: Bearing,
  observedAt: EpochMs,
});
export type SystemTrack = z.infer<typeof SystemTrackSchema>;

// ---------------------------------------------------------------- envelope

function message<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({
    type: z.literal(type),
    msgId: z.uuid(),
    ts: EpochMs,
    payload,
  });
}

const Empty = z.object({});

// ---------------------------------------------------------------- unit -> Command Center

const RegisterPayload = z.discriminatedUnion("unitType", [
  z.object({
    unitType: z.literal("radar"),
    key: z.string(),
    /** The device's Ed25519 public key (raw, base64). */
    publicKey: z.string().min(1),
    name: z.string().min(1),
    position: LatLonSchema,
    capabilities: RadarCapabilitiesSchema,
  }),
  z.object({
    unitType: z.literal("weapon"),
    key: z.string(),
    publicKey: z.string().min(1),
    name: z.string().min(1),
    position: LatLonSchema,
    capabilities: WeaponCapabilitiesSchema,
  }),
]);

export const ToCommandCenterSchema = z.discriminatedUnion("type", [
  message("register", RegisterPayload),
  /** Proof of identity: the `challenge` nonce signed with the device's private key. */
  message("challengeResponse", z.object({ signature: z.string().min(1) })),
  message("heartbeat", Empty),
  // radar
  message("tracks", z.object({ scanAt: EpochMs, tracks: z.array(RadarTrackSchema) })),
  message("killReport", z.object({ checkId: Id, destroyed: z.boolean() })),
  // weapon
  message("status", WeaponStatusSchema),
  message(
    "shotFired",
    z.object({ engagementId: Id, firedAt: EpochMs, impactAt: EpochMs, impactPoint: LatLonSchema }),
  ),
  message("fireFailed", z.object({ engagementId: Id, reason: z.string() })),
]);

// ---------------------------------------------------------------- Command Center -> unit

export const FromCommandCenterSchema = z.discriminatedUnion("type", [
  /** Answer to `register`: sign this nonce to prove you hold the device key. */
  message("challenge", z.object({ nonce: z.string() })),
  message("registered", z.object({ unitId: Id })),
  message("rejected", z.object({ reason: RejectReasonSchema, detail: z.string().optional() })),
  /** Manual key, position mismatch: connected but on hold until an operator decides. */
  message("pending", z.object({ reason: z.literal("POSITION_MISMATCH"), distanceM: Meters })),
  message("revoked", Empty),
  // radar
  /** A weapon hit the object behind this radar track; remove it from the world and confirm. */
  message("confirmKill", z.object({ checkId: Id, radarTrackId: Id })),
  // weapon
  message("prepare", z.object({ engagementId: Id, track: SystemTrackSchema })),
  message("trackUpdate", z.object({ engagementId: Id, track: SystemTrackSchema })),
  message("fire", z.object({ engagementId: Id })),
  message("cancel", z.object({ engagementId: Id, reason: z.string().optional() })),
  message("setRanges", RangesSchema),
]);

// ---------------------------------------------------------------- radar -> World Simulator

export const ToWorldSimSchema = z.discriminatedUnion("type", [
  message(
    "hello",
    z.object({ radarId: Id, position: LatLonSchema, rangeM: z.number().positive() }),
  ),
  message("scan", z.object({ scanId: Id, position: LatLonSchema, rangeM: z.number().positive() })),
  /** The object was hit by a weapon (a computed shot always hits): remove it. */
  message("targetHit", z.object({ truthId: Id })),
]);

// ---------------------------------------------------------------- World Simulator -> radar

export const DetectionSchema = z.object({
  /** Ground-truth id. Radars use it only to link consecutive scans; never forwarded. */
  truthId: Id,
  position: LatLonSchema,
  altitudeM: z.number(),
  /** 0..1 radar signature (high for vehicles, low for birds). */
  signature: z.number().min(0).max(1),
  iffResponds: z.boolean(),
});
export type Detection = z.infer<typeof DetectionSchema>;

export const FromWorldSimSchema = z.discriminatedUnion("type", [
  message(
    "scanResult",
    z.object({
      scanId: Id,
      /** When the detected positions were true (the world's last tick), epoch ms. */
      observedAt: EpochMs,
      detections: z.array(DetectionSchema),
    }),
  ),
]);

// ---------------------------------------------------------------- shared by all servers

/** Sent by a server when it can't accept a message. */
export const ErrorMessageSchema = message(
  "error",
  z.object({ code: z.string(), detail: z.string() }),
);

// ---------------------------------------------------------------- types & helpers

export type ToCommandCenter = z.infer<typeof ToCommandCenterSchema>;
export type FromCommandCenter = z.infer<typeof FromCommandCenterSchema>;
export type ToWorldSim = z.infer<typeof ToWorldSimSchema>;
export type FromWorldSim = z.infer<typeof FromWorldSimSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export type AnyMessage =
  ToCommandCenter | FromCommandCenter | ToWorldSim | FromWorldSim | ErrorMessage;

/** Narrow a message union to one `type`: `MessageOf<ToCommandCenter, "register">`. */
export type MessageOf<M extends AnyMessage, T extends M["type"]> = Extract<M, { type: T }>;
export type PayloadOf<M extends AnyMessage, T extends M["type"]> = MessageOf<M, T>["payload"];

/** Builds an envelope with a fresh id and the current time. */
export function createMessage<M extends AnyMessage, T extends M["type"]>(
  type: T,
  payload: PayloadOf<M, T>,
): MessageOf<M, T> {
  return { type, msgId: crypto.randomUUID(), ts: Date.now(), payload } as MessageOf<M, T>;
}

export type ParseResult<M> = { ok: true; message: M } | { ok: false; error: string };

/** Parses raw socket data against one link's schema. Never throws. */
export function parseMessage<S extends z.ZodType>(schema: S, raw: string): ParseResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
