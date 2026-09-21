/**
 * Money handling rules (see docs/02-data-model.md §money):
 *  - amounts are stored as `numeric(20,8)` and ONLY ever handled as decimal strings in JS
 *  - never use JS floats for money
 *  - comparisons and arithmetic happen on scaled BigInt
 */
const SCALE = 8;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

export class MoneyError extends Error {}

const AMOUNT_RE = /^-?\d{1,12}(\.\d{1,8})?$/;

export function isValidAmount(value: string): boolean {
  return AMOUNT_RE.test(value);
}

export function assertAmount(value: string, label = 'amount'): string {
  if (!isValidAmount(value)) throw new MoneyError(`${label} must be a decimal string with up to 8 decimals`);
  return value;
}

/** decimal string -> scaled bigint (1.5 -> 150000000n) */
export function toScaled(value: string): bigint {
  assertAmount(value);
  const neg = value.startsWith('-');
  const [int, frac = ''] = (neg ? value.slice(1) : value).split('.') as [string, string?];
  const padded = (frac ?? '').padEnd(SCALE, '0');
  const scaled = BigInt(int!) * SCALE_FACTOR + BigInt(padded);
  return neg ? -scaled : scaled;
}

/** scaled bigint -> canonical decimal string with trailing zeros trimmed (150000000n -> "1.5") */
export function fromScaled(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const int = abs / SCALE_FACTOR;
  const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  const out = frac.length > 0 ? `${int}.${frac}` : int.toString();
  return neg ? `-${out}` : out;
}

export function addAmounts(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subAmounts(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const x = toScaled(a);
  const y = toScaled(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function isZero(amount: string): boolean {
  return toScaled(amount) === 0n;
}

/**
 * Percentage of an amount, rounded DOWN at the 8th decimal (favours the merchant on fees).
 * `percent` is a decimal string, e.g. "2.5".
 */
export function percentOf(amount: string, percent: string): string {
  const p = toScaled(percent);
  const a = toScaled(amount);
  const hundred = toScaled('100');
  return fromScaled((a * p) / hundred);
}

export const ZERO = '0';
