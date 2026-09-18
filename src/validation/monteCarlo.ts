/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Monte Carlo Trade Resampling & Risk of Ruin Engine
 */

import { TradeRecord } from '../strategy/types.js';

export interface MonteCarloSimulationResult {
  iterations: number;
  initialCapital: number;
  medianMaxDrawdownPct: number;
  p95MaxDrawdownPct: number;
  p99MaxDrawdownPct: number;
  medianFinalEquity: number;
  p5FinalEquity: number;
  p95FinalEquity: number;
  ruinProbability30Pct: number; // Probability of experiencing >= 30% drawdown
  ruinProbability50Pct: number; // Probability of experiencing >= 50% drawdown
  medianLosingStreak: number;
  p95LosingStreak: number;
  isRiskAcceptable: boolean;
}

export function runMonteCarloSimulation(
  trades: TradeRecord[],
  initialCapital: number = 100000,
  iterations: number = 1000,
  ruinThresholdPct: number = 50
): MonteCarloSimulationResult {
  if (trades.length < 5) {
    return {
      iterations,
      initialCapital,
      medianMaxDrawdownPct: 0,
      p95MaxDrawdownPct: 0,
      p99MaxDrawdownPct: 0,
      medianFinalEquity: initialCapital,
      p5FinalEquity: initialCapital,
      p95FinalEquity: initialCapital,
      ruinProbability30Pct: 0,
      ruinProbability50Pct: 0,
      medianLosingStreak: 0,
      p95LosingStreak: 0,
      isRiskAcceptable: false,
    };
  }

  const pnlList = trades.map((t) => t.realizedPnlCash);
  const tradeCount = pnlList.length;

  const maxDrawdowns: number[] = [];
  const finalEquities: number[] = [];
  const maxLosingStreaks: number[] = [];

  let ruinCount30 = 0;
  let ruinCount50 = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let eq = initialCapital;
    let peak = initialCapital;
    let maxDdPct = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;

    for (let t = 0; t < tradeCount; t++) {
      // Resample random trade with replacement
      const randomIdx = Math.floor(Math.random() * tradeCount);
      const pnl = pnlList[randomIdx];

      eq += pnl;
      if (eq > peak) {
        peak = eq;
      }
      const ddPct = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (ddPct > maxDdPct) {
        maxDdPct = ddPct;
      }

      if (pnl < 0) {
        currentLossStreak++;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      } else {
        currentLossStreak = 0;
      }
    }

    maxDrawdowns.push(maxDdPct);
    finalEquities.push(eq);
    maxLosingStreaks.push(maxLossStreak);

    if (maxDdPct >= 30) ruinCount30++;
    if (maxDdPct >= ruinThresholdPct) ruinCount50++;
  }

  // Sort results for percentiles
  maxDrawdowns.sort((a, b) => a - b);
  finalEquities.sort((a, b) => a - b);
  maxLosingStreaks.sort((a, b) => a - b);

  const getPercentile = (arr: number[], pct: number) => {
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((pct / 100) * arr.length)));
    return arr[idx];
  };

  const medianMaxDrawdownPct = getPercentile(maxDrawdowns, 50);
  const p95MaxDrawdownPct = getPercentile(maxDrawdowns, 95);
  const p99MaxDrawdownPct = getPercentile(maxDrawdowns, 99);

  const medianFinalEquity = getPercentile(finalEquities, 50);
  const p5FinalEquity = getPercentile(finalEquities, 5);
  const p95FinalEquity = getPercentile(finalEquities, 95);

  const medianLosingStreak = getPercentile(maxLosingStreaks, 50);
  const p95LosingStreak = getPercentile(maxLosingStreaks, 95);

  const ruinProbability30Pct = (ruinCount30 / iterations) * 100;
  const ruinProbability50Pct = (ruinCount50 / iterations) * 100;

  // Criteria for risk acceptability: 95th percentile DD < 30% and Ruin 50% < 1%
  const isRiskAcceptable = p95MaxDrawdownPct < 30 && ruinProbability50Pct < 1.0;

  return {
    iterations,
    initialCapital,
    medianMaxDrawdownPct,
    p95MaxDrawdownPct,
    p99MaxDrawdownPct,
    medianFinalEquity,
    p5FinalEquity,
    p95FinalEquity,
    ruinProbability30Pct,
    ruinProbability50Pct,
    medianLosingStreak,
    p95LosingStreak,
    isRiskAcceptable,
  };
}
