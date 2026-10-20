// UI channel between a Shot Control (weapon) server and its operator page.
// Private to this program; messages are { type, payload }.

import type { LatLon, RejectReason } from "@tdts/shared";
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

export interface WeaponPageState {
  name: string;
  position: LatLon;
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
}

export type ServerToUi =
  { type: "state"; payload: WeaponPageState } | { type: "error"; payload: { detail: string } };

export const UiToServerSchema = z.discriminatedUnion("type", [
  /** The operator entered a registration key from the Command Center. */
  z.object({ type: z.literal("setKey"), payload: z.object({ key: z.string() }) }),
]);
export type UiToServer = z.infer<typeof UiToServerSchema>;
