/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * High-Fidelity Synthetic Market Generator
 *
 * Simulates multi-regime financial price series with:
 * - Geometric Brownian Motion (GBM)
 * - Regime-switching drift & stochastic volatility
 * - Fat tails & jump diffusion
 * - Volatility squeeze and expansion cycles
 * - Realistic volume dynamics correlated with volatility
 */

import { Candle } from '../strategy/types.js';

export interface MarketGeneratorConfig {
  bars: number;
  startPrice: number;
  baseVolDailyPct: number;
  seed?: number;
  timeframeMinutes?: number;
}

export function generateSyntheticMarket(config: MarketGeneratorConfig): Candle[] {
  const {
    bars,
    startPrice,
    baseVolDailyPct,
    timeframeMinutes = 15,
  } = config;

  const candles: Candle[] = [];
  let price = startPrice;
  let currentVolDaily = baseVolDailyPct;
  const dt = timeframeMinutes / (24 * 60); // Fraction of a day
  const baseSigma = (baseVolDailyPct / 100) * Math.sqrt(dt);

  // Time base starting ~180 days ago
  let currentTime = Date.now() - bars * timeframeMinutes * 60 * 1000;

  // Pseudo-random Gaussian generator with seed option
  let seedVal = config.seed ?? 42;
  const pseudoRandom = () => {
    seedVal = (seedVal * 9301 + 49297) % 233280;
    return seedVal / 233280;
  };

  const nextGaussian = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = pseudoRandom();
    while (v === 0) v = pseudoRandom();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  // Regime segments
  // We divide the history into 5 distinct quantitative market regimes:
  // 1. Initial Mean-Reverting Range (20% of bars)
  // 2. Strong Bullish Trend (25% of bars)
  // 3. Volatility Squeeze / Low Volatility (15% of bars)
  // 4. High-Volatility Flash Shock & Downtrend (20% of bars)
  // 5. Emerging Trend / Transition Recovery (20% of bars)

  for (let i = 0; i < bars; i++) {
    const progress = i / bars;
    let regimeDriftAnnual = 0.0;
    let volMultiplier = 1.0;

    if (progress < 0.20) {
      // Regime 1: Mean Reversion Range
      regimeDriftAnnual = 0.0;
      volMultiplier = 0.9;
    } else if (progress < 0.45) {
      // Regime 2: Strong Bull Trend
      regimeDriftAnnual = 0.45; // 45% annual bull drift
      volMultiplier = 1.1;
    } else if (progress < 0.60) {
      // Regime 3: Low Volatility Compression Squeeze
      regimeDriftAnnual = 0.05;
      volMultiplier = 0.45; // compressed volatility
    } else if (progress < 0.80) {
      // Regime 4: High Volatility Shock & Downtrend
      regimeDriftAnnual = -0.50; // sharp selloff
      volMultiplier = 2.2; // spike in volatility
    } else {
      // Regime 5: Recovery Transition
      regimeDriftAnnual = 0.25;
      volMultiplier = 1.2;
    }

    const dailyDrift = regimeDriftAnnual / 252;
    const barDrift = dailyDrift * dt;
    const barSigma = baseSigma * volMultiplier;

    // Jump-diffusion shock (1% chance of fat tail shock)
    let jump = 0;
    if (pseudoRandom() < 0.01) {
      jump = (nextGaussian() > 0 ? 1 : -1) * barSigma * 3.5;
    }

    const shock = nextGaussian();
    const returnPct = barDrift + barSigma * shock + jump;

    const open = price;
    const close = Math.max(0.01, open * Math.exp(returnPct));

    // Realistic intrabar excursions for High & Low
    const highShock = Math.abs(nextGaussian()) * barSigma * 0.7;
    const lowShock = Math.abs(nextGaussian()) * barSigma * 0.7;
    const high = Math.max(open, close) * (1 + highShock);
    const low = Math.min(open, close) * (1 - lowShock);

    // Realistic volume proportional to volatility & price movement
    const baseVolume = 1000;
    const volActivity = Math.abs(returnPct) / barSigma;
    const volume = Math.round(baseVolume * (0.6 + volActivity * 0.8 + pseudoRandom() * 0.5));

    candles.push({
      time: currentTime,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
    currentTime += timeframeMinutes * 60 * 1000;
  }

  return candles;
}

export function getPresetMarketDatasets(bars: number = 1000): {
  btc: Candle[];
  eth: Candle[];
  eurusd: Candle[];
  spy: Candle[];
  gold: Candle[];
} {
  return {
    btc: generateSyntheticMarket({
      bars,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 101,
      timeframeMinutes: 15,
    }),
    eth: generateSyntheticMarket({
      bars,
      startPrice: 3500,
      baseVolDailyPct: 4.5,
      seed: 202,
      timeframeMinutes: 15,
    }),
    eurusd: generateSyntheticMarket({
      bars,
      startPrice: 1.085,
      baseVolDailyPct: 0.6,
      seed: 303,
      timeframeMinutes: 15,
    }),
    spy: generateSyntheticMarket({
      bars,
      startPrice: 520,
      baseVolDailyPct: 1.1,
      seed: 404,
      timeframeMinutes: 15,
    }),
    gold: generateSyntheticMarket({
      bars,
      startPrice: 2400,
      baseVolDailyPct: 1.4,
      seed: 505,
      timeframeMinutes: 15,
    }),
  };
}
