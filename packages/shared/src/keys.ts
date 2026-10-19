// Registration keys: TDTS-XXXX-XXXX-XXXX, 12 random Crockford base32 characters
// (60 bits). Crockford's alphabet leaves out I, L, O and U so keys are easy to
// read and type.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_PATTERN = /^TDTS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  // 256 is a multiple of 32, so `% 32` is unbiased.
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
  return `TDTS-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function isValidKeyFormat(key: string): boolean {
  return KEY_PATTERN.test(key);
}
