// UI channel between the Command Center server and its operator page.
// Private to this program; messages are { type, payload }.

import { LatLonSchema, MapViewSchema, UnitTypeSchema } from "@tdts/shared";
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
  createdAt: z.number(),
});
export type KeyRecord = z.infer<typeof KeyRecordSchema>;

// ---------------------------------------------------------------- messages

export const CommandStateSchema = z.object({
  view: MapViewSchema,
  keys: z.array(KeyRecordSchema),
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
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
