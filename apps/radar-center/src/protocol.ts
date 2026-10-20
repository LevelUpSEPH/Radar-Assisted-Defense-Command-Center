// UI channel between a Radar Center server and its operator page. Private to
// this program; messages are { type, payload }.

import type { LatLon, RejectReason } from "@tdts/shared";

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

export interface RadarState {
  name: string;
  position: LatLon;
  rangeM: number;
  /** Fingerprint of this radar's device key. */
  deviceId: string;
  commandCenterUrl: string;
  link: LinkStatus;
}

export type ServerToUi = { type: "state"; payload: RadarState };
