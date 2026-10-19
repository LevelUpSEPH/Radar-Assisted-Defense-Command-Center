// Scenario files loaded by the World Simulator (DESIGN.md §4).

import { z } from "zod";
import { CitySchema, LatLonSchema } from "./messages";

export const TargetKindSchema = z.enum(["drone", "friendly", "bird"]);
export type TargetKind = z.infer<typeof TargetKindSchema>;

export const WaveTargetSchema = z.object({
  id: z.string().min(1),
  kind: TargetKindSchema,
  /** Seconds after the wave starts. */
  spawnAtS: z.number().nonnegative(),
  start: LatLonSchema,
  destination: LatLonSchema,
  speedMps: z.number().positive(),
  altitudeM: z.number().nonnegative(),
});
export type WaveTarget = z.infer<typeof WaveTargetSchema>;

export const WaveFileSchema = z
  .object({
    name: z.string().min(1),
    targets: z.array(WaveTargetSchema).min(1),
  })
  .refine((w) => new Set(w.targets.map((t) => t.id)).size === w.targets.length, {
    message: "target ids must be unique within a wave",
  });
export type WaveFile = z.infer<typeof WaveFileSchema>;

export const CitiesFileSchema = z.object({
  cities: z.array(CitySchema),
});
export type CitiesFile = z.infer<typeof CitiesFileSchema>;
