// UI channel between the Command Center server and its operator page, plus the
// records it saves. Private to this program; messages are { type, payload }.

import {
  IffSchema,
  LatLonSchema,
  MapViewSchema,
  RadarCapabilitiesSchema,
  RadarTrackSchema,
  UnitTypeSchema,
  WeaponCapabilitiesSchema,
} from "@tdts/shared";
import { z } from "zod";

// ---------------------------------------------------------------- keys (DESIGN.md §3)

export const KeyStatusSchema = z.enum(["ISSUED", "BOUND", "REVOKED"]);
export type KeyStatus = z.infer<typeof KeyStatusSchema>;

/** What the operator asks for when generating a key. */
export const KeyRequestSchema = z.discriminatedUnion("mode", [
  /** The unit registers itself with whatever name and position it reports. */
  z.object({ mode: z.literal("auto"), unitType: UnitTypeSchema }),
  /** The operator says who and roughly where; the unit must match on connect. */
  z.object({
    mode: z.literal("manual"),
    unitType: UnitTypeSchema,
    name: z.string().trim().min(1, "name is required"),
    expectedPosition: LatLonSchema,
  }),
]);
export type KeyRequest = z.infer<typeof KeyRequestSchema>;

export const KeyRecordSchema = z.object({
  key: z.string(),
  unitType: UnitTypeSchema,
  mode: z.enum(["auto", "manual"]),
  name: z.string().optional(),
  expectedPosition: LatLonSchema.optional(),
  status: KeyStatusSchema,
  /** Set once a unit has registered with this key. */
  unitId: z.string().optional(),
  createdAt: z.number(),
});
export type KeyRecord = z.infer<typeof KeyRecordSchema>;

// ---------------------------------------------------------------- units (DESIGN.md §3)

/** A unit as it described itself: type-specific capabilities. */
const unitBody = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion("unitType", [
    z.object({ ...shape, unitType: z.literal("radar"), capabilities: RadarCapabilitiesSchema }),
    z.object({ ...shape, unitType: z.literal("weapon"), capabilities: WeaponCapabilitiesSchema }),
  ]);

/** A registered unit, as saved in the data file. */
export const UnitRecordSchema = unitBody({
  unitId: z.string(),
  key: z.string(),
  name: z.string(),
  position: LatLonSchema,
  /** The device's Ed25519 public key; only this device may use the key again. */
  publicKey: z.string().optional(),
  /** Short fingerprint of `publicKey`, for display. */
  deviceId: z.string().optional(),
  registeredAt: z.number(),
});
export type UnitRecord = z.infer<typeof UnitRecordSchema>;

export const UnitStatusSchema = z.enum(["ONLINE", "OFFLINE", "PENDING"]);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

/** What the operator sees: registered units plus units waiting for approval. */
export const UnitViewSchema = unitBody({
  /** Null while PENDING: a pending unit isn't registered yet. */
  unitId: z.string().nullable(),
  key: z.string(),
  name: z.string(),
  position: LatLonSchema,
  deviceId: z.string().optional(),
  status: UnitStatusSchema,
  /** PENDING only: how far it connected from the key's expected position. */
  distanceM: z.number().optional(),
});
export type UnitView = z.infer<typeof UnitViewSchema>;

// ---------------------------------------------------------------- air picture (DESIGN.md §4)

/** A track as one radar reports it, tagged with that radar's unit id. */
export const AirTrackSchema = RadarTrackSchema.extend({
  unitId: z.string(),
  /** Where the radar reported it in recent sweeps, oldest first. */
  trail: z.array(LatLonSchema),
});
export type AirTrack = z.infer<typeof AirTrackSchema>;

/** One radar's contribution to a system track. */
export const TrackSourceSchema = z.object({
  unitId: z.string(),
  radarTrackId: z.string(),
  iff: IffSchema,
  likelihood: z.number(),
});
export type TrackSource = z.infer<typeof TrackSourceSchema>;

/** A fused track: one object, as seen by one or more radars (DESIGN.md §4–5). */
export const SystemTrackViewSchema = z.object({
  /** "S-0001", … */
  trackId: z.string(),
  position: LatLonSchema,
  altitudeM: z.number(),
  speedMps: z.number(),
  headingDeg: z.number(),
  /** The highest drone likelihood any radar reports. */
  likelihood: z.number(),
  observedAt: z.number(),
  sources: z.array(TrackSourceSchema),
  classification: IffSchema,
  /** Who decided: the radar reports, or the operator overriding them. */
  classificationSource: z.enum(["radars", "operator"]),
  /** Enemy, and likely enough a drone to engage. */
  engageable: z.boolean(),
  /** Recent fused positions, oldest first. */
  trail: z.array(LatLonSchema),
});
export type SystemTrackView = z.infer<typeof SystemTrackViewSchema>;

// ---------------------------------------------------------------- messages

export const CommandStateSchema = z.object({
  view: MapViewSchema,
  keys: z.array(KeyRecordSchema),
  units: z.array(UnitViewSchema),
  /** Fused tracks with their classification. */
  tracks: z.array(SystemTrackViewSchema),
  /** Enemy tracks at or above this drone likelihood are engageable. */
  minLikelihoodToEngage: z.number(),
});
export type CommandState = z.infer<typeof CommandStateSchema>;

export const ServerToUiSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), payload: CommandStateSchema }),
  z.object({ type: z.literal("error"), payload: z.object({ detail: z.string() }) }),
]);
export type ServerToUi = z.infer<typeof ServerToUiSchema>;

export const UiToServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("generateKey"), payload: KeyRequestSchema }),
  z.object({ type: z.literal("deleteKey"), payload: z.object({ key: z.string() }) }),
  /** Pending units are identified by their key (they have no unit id yet). */
  z.object({ type: z.literal("approveUnit"), payload: z.object({ key: z.string() }) }),
  z.object({ type: z.literal("rejectUnit"), payload: z.object({ key: z.string() }) }),
  /** The operator overrides a track's classification; null hands it back to the radars. */
  z.object({
    type: z.literal("classifyTrack"),
    payload: z.object({ trackId: z.string(), classification: IffSchema.nullable() }),
  }),
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
