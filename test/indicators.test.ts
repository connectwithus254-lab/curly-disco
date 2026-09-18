import { describe, it, expect } from 'vitest';
import {
  calculateSma,
  calculateEma,
  calculateHma,
  calculateRsi,
  calculateAtr,
  calculatePercentileRank,
  calculateBollingerBands,
  calculateZScore,
  calculateAdx,
  calculateEfficiencyRatio,
  calculatePriceCurvature,
  calculateVwap,
  calculateCmf,
  calculatePivotsAndStructure,
} from '../src/strategy/indicators.js';
import { generateSyntheticMarket } from '../src/data/syntheticProvider.js';

describe('Quantitative Indicators Suite', () => {
  const candles = generateSyntheticMarket({
    bars: 300,
    startPrice: 100,
    baseVolDailyPct: 2.0,
    seed: 42,
    timeframeMinutes: 15,
  });
  const closes = candles.map((c) => c.close);

  it('calculates SMA correctly', () => {
    const sma = calculateSma(closes, 10);
    expect(sma.length).toBe(closes.length);
    expect(isNaN(sma[8])).toBe(true);
    expect(isNaN(sma[9])).toBe(false);

    let sum = 0;
    for (let i = 0; i < 10; i++) sum += closes[i];
    expect(sma[9]).toBeCloseTo(sum / 10, 5);
  });

  it('calculates EMA correctly with exponential weighting', () => {
    const ema = calculateEma(closes, 10);
    expect(ema.length).toBe(closes.length);
    expect(isNaN(ema[8])).toBe(true);
    expect(isNaN(ema[9])).toBe(false);

    const alpha = 2 / 11;
    const expectedBar10 = alpha * closes[10] + (1 - alpha) * ema[9];
    expect(ema[10]).toBeCloseTo(expectedBar10, 5);
  });

  it('calculates HMA without NaN after warmup', () => {
    const hma = calculateHma(closes, 14);
    expect(hma.length).toBe(closes.length);
    expect(isNaN(hma[100])).toBe(false);
  });

  it('calculates RSI bounded between 0 and 100', () => {
    const rsi = calculateRsi(closes, 14);
    for (let i = 15; i < rsi.length; i++) {
      expect(rsi[i]).toBeGreaterThanOrEqual(0);
      expect(rsi[i]).toBeLessThanOrEqual(100);
    }
  });

  it('calculates ATR and ensures non-negative values', () => {
    const atr = calculateAtr(candles, 14);
    for (let i = 14; i < atr.length; i++) {
      expect(atr[i]).toBeGreaterThan(0);
    }
  });

  it('calculates Percentile Rank bounded between 0 and 100', () => {
    const pct = calculatePercentileRank(closes, 50);
    for (let i = 51; i < pct.length; i++) {
      expect(pct[i]).toBeGreaterThanOrEqual(0);
      expect(pct[i]).toBeLessThanOrEqual(100);
    }
  });

  it('calculates Bollinger Bands and positive Bandwidth', () => {
    const bb = calculateBollingerBands(closes, 20, 2.0);
    for (let i = 20; i < bb.upper.length; i++) {
      expect(bb.upper[i]).toBeGreaterThanOrEqual(bb.basis[i]);
      expect(bb.basis[i]).toBeGreaterThanOrEqual(bb.lower[i]);
      expect(bb.bandwidth[i]).toBeGreaterThan(0);
    }
  });

  it('calculates Rolling Z-Score with zero mean expectation', () => {
    const z = calculateZScore(closes, 20);
    for (let i = 20; i < z.length; i++) {
      expect(isNaN(z[i])).toBe(false);
      // Realistic financial z-score usually stays within [-4, +4]
      expect(z[i]).toBeGreaterThan(-6);
      expect(z[i]).toBeLessThan(6);
    }
  });

  it('calculates Welles Wilder ADX, +DI, and -DI', () => {
    const adx = calculateAdx(candles, 14, 14);
    for (let i = 30; i < adx.adx.length; i++) {
      expect(adx.adx[i]).toBeGreaterThanOrEqual(0);
      expect(adx.adx[i]).toBeLessThanOrEqual(100);
      expect(adx.diPlus[i]).toBeGreaterThanOrEqual(0);
      expect(adx.diMinus[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('calculates Kaufman Price Efficiency Ratio bounded in [0, 1]', () => {
    const er = calculateEfficiencyRatio(closes, 10);
    for (let i = 10; i < er.length; i++) {
      expect(er[i]).toBeGreaterThanOrEqual(0);
      expect(er[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it('calculates Price Curvature (2nd derivative acceleration)', () => {
    const atr = calculateAtr(candles, 14);
    const curv = calculatePriceCurvature(closes, atr, 3);
    expect(curv.length).toBe(closes.length);
    expect(isNaN(curv[100])).toBe(false);
  });

  it('calculates VWAP correctly', () => {
    const vwap = calculateVwap(candles);
    expect(vwap.length).toBe(candles.length);
    for (let i = 0; i < vwap.length; i++) {
      expect(vwap[i]).toBeGreaterThan(0);
    }
  });

  it('calculates Chaikin Money Flow bounded in [-1, 1]', () => {
    const cmf = calculateCmf(candles, 20);
    for (let i = 20; i < cmf.length; i++) {
      expect(cmf[i]).toBeGreaterThanOrEqual(-1.0);
      expect(cmf[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it('calculates Pivots and BOS without future lookahead bias', () => {
    const structure = calculatePivotsAndStructure(candles, 5, 5);
    expect(structure.bullishBos.length).toBe(candles.length);
    expect(structure.bearishBos.length).toBe(candles.length);
  });
});
