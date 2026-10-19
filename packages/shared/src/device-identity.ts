// Device identity (Command Center DESIGN.md §3, Device keys). Each radar and
// weapon has its own Ed25519 key pair. The private key never leaves the device;
// the Command Center keeps the public key and, on every connection, asks the
// unit to sign a fresh random challenge. A copied registration key is useless
// without the device's private key.
//
// Uses Web Crypto (crypto.subtle), so it works in Node and browsers alike.
// Keys and signatures travel as base64 strings.

const ALGORITHM = { name: "Ed25519" } as const;

export interface DeviceKeys {
  /** Raw 32-byte public key, base64. Sent to the Command Center. */
  publicKey: string;
  /** PKCS#8 private key, base64. Stays on the device. */
  privateKey: string;
}

export async function generateDeviceKeys(): Promise<DeviceKeys> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("expected an Ed25519 key pair");
  return {
    publicKey: toBase64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: toBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  };
}

/** A random challenge (32 bytes, base64). */
export function newChallengeNonce(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * What exactly gets signed: the nonce bound to the registration key, so a
 * signature can't be replayed for another key or another connection.
 */
function challengeText(nonce: string, registrationKey: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`tdts-device-challenge:${registrationKey}:${nonce}`);
}

export async function signChallenge(
  privateKey: string,
  nonce: string,
  registrationKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", fromBase64(privateKey), ALGORITHM, false, [
    "sign",
  ]);
  return toBase64(await crypto.subtle.sign(ALGORITHM, key, challengeText(nonce, registrationKey)));
}

/** True only for a valid signature by `publicKey`. Malformed input is simply invalid. */
export async function verifyChallenge(
  publicKey: string,
  nonce: string,
  registrationKey: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(publicKey), ALGORITHM, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      ALGORITHM,
      key,
      fromBase64(signature),
      challengeText(nonce, registrationKey),
    );
  } catch {
    return false;
  }
}

/** Short, human-readable id of a public key (first 8 bytes of its SHA-256, hex). */
export async function deviceFingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64(publicKey)));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
