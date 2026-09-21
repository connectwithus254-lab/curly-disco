import { describe, expect, it } from 'vitest';
import { addAmounts, compareAmounts, fromScaled, percentOf, subAmounts, toScaled, isValidAmount } from '@botshop/core';

describe('money handling', () => {
  it('parses decimal strings without floating point drift', () => {
    expect(toScaled('0.1')).toBe(10_000_000n);
    expect(toScaled('0.2')).toBe(20_000_000n);
    // The classic float bug: 0.1 + 0.2 = 0.30000000000000004
    expect(addAmounts('0.1', '0.2')).toBe('0.3');
  });

  it('handles large sums and 8-decimal crypto precision', () => {
    expect(addAmounts('999999999999.99999999', '0.00000001')).toBe('1000000000000');
    expect(subAmounts('1', '0.00000001')).toBe('0.99999999');
    expect(fromScaled(123456789n)).toBe('1.23456789');
  });

  it('compares amounts numerically, not lexicographically', () => {
    expect(compareAmounts('9.5', '10')).toBe(-1);
    expect(compareAmounts('10.00000000', '10')).toBe(0);
    expect(compareAmounts('0.00000002', '0.00000001')).toBe(1);
  });

  it('rounds fees down so the merchant is never overcharged', () => {
    expect(percentOf('100', '2.5')).toBe('2.5');
    expect(percentOf('19.99', '2.5')).toBe('0.49975');
    // 1% of 0.00000004 floors to 0 at 8-decimal precision
    expect(percentOf('0.00000004', '1')).toBe('0');
  });

  it('rejects anything that is not a decimal string', () => {
    expect(isValidAmount('1.5')).toBe(true);
    expect(isValidAmount('1e5')).toBe(false);
    expect(isValidAmount('NaN')).toBe(false);
    expect(isValidAmount('1.123456789')).toBe(false);
    expect(() => toScaled('abc')).toThrow();
  });
});
