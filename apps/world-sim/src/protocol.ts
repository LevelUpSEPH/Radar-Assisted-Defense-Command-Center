// UI channel between the World Simulator server and its truth-map page
// (DESIGN.md §5). Private to this program; messages are { type, payload }.

import { LatLonSchema, MapViewSchema, TargetKindSchema } from "@tdts/shared";
import { z } from "zod";

export const TruthTargetSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: TargetKindSchema,
  position: LatLonSchema,
  destination: LatLonSchema,
  altitudeM: z.number(),
  speedMps: z.number(),
  headingDeg: z.number(),
  signature: z.number(),
  iffResponds: z.boolean(),
});
export type TruthTarget = z.infer<typeof TruthTargetSchema>;

/** A target removed after a radar reported a weapon hit; shown briefly on the map. */
export const KillSchema = z.object({
  targetId: z.string(),
  kind: TargetKindSchema,
  point: LatLonSchema,
  at: z.number(),
});
export type Kill = z.infer<typeof KillSchema>;

export const ConnectedRadarSchema = z.object({
  radarId: z.string(),
  position: LatLonSchema,
  rangeM: z.number(),
});
export type ConnectedRadar = z.infer<typeof ConnectedRadarSchema>;

export const WaveRunSchema = z.object({
  runId: z.string(),
  name: z.string(),
  file: z.string(),
  startedAt: z.number(),
  scheduled: z.number(),
  flying: z.number(),
  arrived: z.number(),
  destroyed: z.number(),
  finished: z.boolean(),
});
export type WaveRun = z.infer<typeof WaveRunSchema>;

export const WaveFileInfoSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), file: z.string(), name: z.string(), targetCount: z.number() }),
  z.object({ ok: z.literal(false), file: z.string(), error: z.string() }),
]);
export type WaveFileInfo = z.infer<typeof WaveFileInfoSchema>;

export const LogEntrySchema = z.object({
  at: z.number(),
  kind: z.enum(["wave", "spawn", "arrive", "destroy", "info"]),
  text: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const WorldStateSchema = z.object({
  now: z.number(),
  targets: z.array(TruthTargetSchema),
  kills: z.array(KillSchema),
  radars: z.array(ConnectedRadarSchema),
  waveRuns: z.array(WaveRunSchema),
  log: z.array(LogEntrySchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const ServerToUiSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("init"),
    payload: z.object({ view: MapViewSchema, waveFiles: z.array(WaveFileInfoSchema) }),
  }),
  z.object({ type: z.literal("state"), payload: WorldStateSchema }),
  z.object({
    type: z.literal("waveFiles"),
    payload: z.object({ waveFiles: z.array(WaveFileInfoSchema) }),
  }),
  z.object({ type: z.literal("error"), payload: z.object({ detail: z.string() }) }),
]);
export type ServerToUi = z.infer<typeof ServerToUiSchema>;

export const UiToServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("startWave"), payload: z.object({ file: z.string() }) }),
  z.object({ type: z.literal("stopAll"), payload: z.object({}) }),
  z.object({ type: z.literal("refreshWaves"), payload: z.object({}) }),
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
