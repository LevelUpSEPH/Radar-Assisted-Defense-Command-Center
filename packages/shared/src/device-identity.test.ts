import { describe, expect, it } from "vitest";
import {
  deviceFingerprint,
  generateDeviceKeys,
  newChallengeNonce,
  signChallenge,
  verifyChallenge,
} from "./device-identity";

const KEY = "TDTS-0000-0000-0000";

describe("device identity", () => {
  it("verifies a signature from the matching private key", async () => {
    const device = await generateDeviceKeys();
    const nonce = newChallengeNonce();
    const sig = await signChallenge(device.privateKey, nonce, KEY);
    expect(await verifyChallenge(device.publicKey, nonce, KEY, sig)).toBe(true);
  });

  it("rejects another device's signature", async () => {
    const real = await generateDeviceKeys();
    const impostor = await generateDeviceKeys();
    const nonce = newChallengeNonce();
    const sig = await signChallenge(impostor.privateKey, nonce, KEY);
    expect(await verifyChallenge(real.publicKey, nonce, KEY, sig)).toBe(false);
  });

  it("rejects a signature replayed for another nonce or another key", async () => {
    const device = await generateDeviceKeys();
    const nonce = newChallengeNonce();
    const sig = await signChallenge(device.privateKey, nonce, KEY);
    expect(await verifyChallenge(device.publicKey, newChallengeNonce(), KEY, sig)).toBe(false);
    expect(await verifyChallenge(device.publicKey, nonce, "TDTS-1111-1111-1111", sig)).toBe(false);
  });

  it("treats malformed input as invalid instead of throwing", async () => {
    const device = await generateDeviceKeys();
    expect(await verifyChallenge("not base64!", "x", KEY, "y")).toBe(false);
    expect(await verifyChallenge(device.publicKey, "x", KEY, "AAAA")).toBe(false);
  });

  it("makes fresh nonces and stable 16-hex-digit fingerprints", async () => {
    expect(newChallengeNonce()).not.toBe(newChallengeNonce());
    const { publicKey } = await generateDeviceKeys();
    const fp = await deviceFingerprint(publicKey);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(await deviceFingerprint(publicKey)).toBe(fp);
  });
});
