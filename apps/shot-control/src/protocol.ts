// UI channel between a Shot Control (weapon) server and its operator page.
// Private to this program; messages are { type, payload }.

import type { LatLon, PayloadOf, RejectReason, SystemTrack, ToCommandCenter } from "@tdts/shared";
import { z } from "zod";

/** Where this weapon stands with the Command Center. */
export type LinkStatus =
  /** No registration key entered yet: nothing to connect with. */
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

type Solution = { fireAt: number; impactAt: number; impactPoint: LatLon; distanceM: number };

export interface WeaponPageState {
  name: string;
  position: LatLon;
  /** The ranges in use now (the config's, unless changed since). */
  minRangeM: number;
  maxRangeM: number;
  ammo: number;
  prepareTimeS: number;
  reloadTimeS: number;
  shellSpeedMps: number;
  /** Fingerprint of this weapon's device key. */
  deviceId: string;
  commandCenterUrl: string;
  /** The registration key in use, or null until one is entered. */
  registrationKey: string | null;
  link: LinkStatus;
  /** The weapon right now: state, ammo, phase end (as reported to the Command Center). */
  status: PayloadOf<ToCommandCenter, "status">;
  /** The engagement in progress, if any. */
  engagement: {
    engagementId: string;
    trackId: string;
    /** The target as the Command Center last described it. */
    track: SystemTrack;
    /** Set once told to fire: when it shoots and where the shell lands. */
    solution: Solution | null;
    /** Until told to fire: where the shell would meet the target once ready. */
    predicted: Solution | null;
  } | null;
  lastShot: PayloadOf<ToCommandCenter, "shotFired"> | null;
}

export type ServerToUi =
  { type: "state"; payload: WeaponPageState } | { type: "error"; payload: { detail: string } };

export const UiToServerSchema = z.discriminatedUnion("type", [
  /** The operator entered a registration key from the Command Center. */
  z.object({ type: z.literal("setKey"), payload: z.object({ key: z.string() }) }),
  /** The operator changed the weapon's min/max range (meters). */
  z.object({
    type: z.literal("setRanges"),
    payload: z.object({ minRangeM: z.number(), maxRangeM: z.number() }),
  }),
  /** The operator stops the current engagement before the shot. */
  z.object({ type: z.literal("stopEngagement"), payload: z.object({}) }),
  /** The operator wants the current preparation to start over. */
  z.object({ type: z.literal("restartEngagement"), payload: z.object({}) }),
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
