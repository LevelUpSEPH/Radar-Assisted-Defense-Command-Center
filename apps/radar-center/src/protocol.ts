// UI channel between a Radar Center server and its operator page. Private to
// this program; messages are { type, payload }.

import { IffSchema, type Iff, type LatLon, type RejectReason } from "@tdts/shared";
import { z } from "zod";

/** Where this radar stands with the Command Center. */
export type LinkStatus =
  /** No registration key configured: nothing to connect with. */
  | { state: "no-key" }
  /** Trying to reach the Command Center (or retrying after a drop). */
  | { state: "connecting" }
  /** Challenge signed; waiting for the verdict. */
  | { state: "verifying" }
  | { state: "registered"; unitId: string }
  /** Manual key, connected from the wrong place: waiting for the operator. */
  | { state: "pending"; distanceM: number }
  | { state: "rejected"; reason: RejectReason; detail?: string }
  | { state: "revoked" };

/** One object this radar sees: only what a radar can measure. */
export interface RadarTrack {
  radarTrackId: string;
  position: LatLon;
  altitudeM: number;
  speedMps: number;
  headingDeg: number;
  /** 0..1 likelihood of being a drone (flying vehicle) rather than a bird or clutter. */
  likelihood: number;
  /** The object answered the IFF interrogation. */
  answersIff: boolean;
  /** The operator's marking, or null. */
  marking: Iff | null;
  /** What goes to the Command Center: the marking, else the IFF reply. */
  iff: Iff;
  /** Recently measured positions, oldest first. */
  trail: LatLon[];
  observedAt: number;
  missedScans: number;
}

export interface RadarState {
  name: string;
  position: LatLon;
  rangeM: number;
  scanIntervalMs: number;
  worldConnected: boolean;
  tracks: RadarTrack[];
  /** Fingerprint of this radar's device key. */
  deviceId: string;
  commandCenterUrl: string;
  /** The registration key in use, or null until one is entered. */
  registrationKey: string | null;
  link: LinkStatus;
}

export type ServerToUi =
  { type: "state"; payload: RadarState } | { type: "error"; payload: { detail: string } };

export const UiToServerSchema = z.discriminatedUnion("type", [
  /** The operator entered a registration key from the Command Center. */
  z.object({ type: z.literal("setKey"), payload: z.object({ key: z.string() }) }),
  /** The operator marks a track friendly, enemy or unknown; null clears the marking. */
  z.object({
    type: z.literal("markTrack"),
    payload: z.object({ radarTrackId: z.string(), marking: IffSchema.nullable() }),
  }),
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
