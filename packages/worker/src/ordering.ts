/**
 * Lexicographic ordering keys for deterministic sibling sort.
 *
 * Keys are base-62 strings (0-9, A-Z, a-z) that support O(1) insertion
 * between any two adjacent siblings via midpoint computation.
 *
 * Invariant: for any two keys a < b, midpoint(a, b) satisfies a < m < b.
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = CHARSET.length; // 62

/** Return the index of a character in the charset. */
function charIndex(c: string): number {
  const i = CHARSET.indexOf(c);
  return i >= 0 ? i : 0;
}

/**
 * Compute a key that sorts between `a` and `b` lexicographically.
 * - If `a` is empty, returns a key before `b`.
 * - If `b` is empty, returns a key after `a`.
 * - Both empty: returns the midpoint of the keyspace.
 */
export function midpoint(a: string, b: string): string {
  if (a >= b && b !== "") {
    throw new Error(`midpoint: a (${a}) must be less than b (${b})`);
  }

  // Pad so we can index both strings uniformly
  const maxLen = Math.max(a.length, b.length) + 1;

  // Convert to arrays of ordinal values
  const aDigits: number[] = [];
  const bDigits: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    aDigits.push(i < a.length ? charIndex(a[i]) : 0);
    bDigits.push(i < b.length ? charIndex(b[i]) : BASE);
  }

  // Find the midpoint digit by digit
  const result: number[] = [];
  let carry = 0;

  for (let i = maxLen - 1; i >= 0; i--) {
    const sum = aDigits[i] + bDigits[i] + carry;
    carry = sum % 2;
    result.unshift(Math.floor(sum / 2));
  }

  // Convert back to string, trimming trailing zeros
  let s = result.map(d => CHARSET[d]).join("");
  // Remove trailing '0' chars (the minimum char) to keep keys short,
  // but never trim to empty
  while (s.length > 1 && s[s.length - 1] === CHARSET[0]) {
    s = s.slice(0, -1);
  }

  return s;
}

/** Generate the initial ordering key for the first sibling. */
export function initialKey(): string {
  // Middle of keyspace — "V" (index 31 of 62)
  return CHARSET[Math.floor(BASE / 2)];
}

/** Generate a key that sorts after the given last key. */
export function keyAfter(last: string): string {
  // Midpoint between last and empty (which represents "end of keyspace")
  return midpoint(last, "");
}

/** Generate a key that sorts before the given first key. */
export function keyBefore(first: string): string {
  // Midpoint between empty (start of keyspace) and first
  return midpoint("", first);
}

/**
 * Compare two siblingOrder keys using code-point ordering.
 * Must be used instead of localeCompare, which is case-insensitive
 * and does not match the CHARSET's code-point sort order.
 */
export function compareSiblingOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Generate a migration key for the i-th task (0-based) in array-order.
 * Produces well-spaced keys like "V", "k", "s", etc. to preserve
 * existing array order as siblingOrder for legacy data.
 */
export function generateMigrationKey(index: number): string {
  let key = initialKey();
  for (let i = 0; i < index; i++) {
    key = keyAfter(key);
  }
  return key;
}
