/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Market Regime Engine
 *
 * Classifies market conditions into 6 discrete regimes:
 * 1. Strong Trend
 * 2. Weak Trend
 * 3. Range
 * 4. High Volatility
 * 5. Low Volatility (Compression / Squeeze)
 * 6. Transition
 */

import { MarketRegimeType, StrategyParameters } from './types.js';

export interface RegimeEvaluation {
  regime: MarketRegimeType;
  effectiveStopMult: number;
  effectiveRr: number;
  effectiveLongThreshold: number;
  effectiveShortThreshold: number;
  description: string;
}

export function evaluateMarketRegime(
  adxVal: number,
  efficiencyRatio: number,
  trendDistAtr: number,
  atrPercentile: number,
  bbwPercentile: number,
  isVolSqueeze: boolean,
  bullishTrendAlign: boolean,
  bearishTrendAlign: boolean,
  params: StrategyParameters
): RegimeEvaluation {
  const isHighVol = atrPercentile >= 80.0 || bbwPercentile >= 85.0;
  const isLowVol = isVolSqueeze || (atrPercentile <= 20.0 && bbwPercentile <= 20.0);
  const isStrongTrend =
    adxVal >= params.adxTrendLevel + 3.0 &&
    efficiencyRatio >= 0.40 &&
    Math.abs(trendDistAtr) >= 1.0;
  const isWeakTrend =
    (adxVal >= 18.0 && efficiencyRatio >= 0.25) ||
    bullishTrendAlign ||
    bearishTrendAlign;
  const isRange =
    adxVal < 20.0 && efficiencyRatio < 0.25 && !isHighVol && !isLowVol;

  let regime: MarketRegimeType = 'TRANSITION';
  let description = 'Market in transitional or mixed directional flow.';

  if (isHighVol) {
    regime = 'HIGH_VOLATILITY';
    description = 'High historical volatility / volatility expansion regime.';
  } else if (isLowVol) {
    regime = 'LOW_VOLATILITY';
    description = 'Low historical volatility / volatility compression squeeze.';
  } else if (isStrongTrend) {
    regime = 'STRONG_TREND';
    description = 'Persistent, high-efficiency directional trend.';
  } else if (isWeakTrend) {
    regime = 'WEAK_TREND';
    description = 'Moderate directional movement or emerging trend.';
  } else if (isRange) {
    regime = 'RANGE';
    description = 'Mean-reverting, low-efficiency horizontal consolidation.';
  }

  // Adaptive Multipliers
  let effectiveStopMult = params.baseAtrStopMult;
  let effectiveRr = params.baseTargetRr;
  let effectiveLongThreshold = params.longThreshold;
  let effectiveShortThreshold = params.shortThreshold;

  if (params.adaptiveRrEnabled) {
    switch (regime) {
      case 'STRONG_TREND':
        effectiveRr = params.baseTargetRr * 1.35;
        effectiveLongThreshold -= 3.0;
        effectiveShortThreshold -= 3.0;
        break;
      case 'RANGE':
        effectiveRr = params.baseTargetRr * 0.75;
        effectiveLongThreshold += 3.0;
        effectiveShortThreshold += 3.0;
        break;
      case 'HIGH_VOLATILITY':
        effectiveStopMult = params.baseAtrStopMult * 1.25;
        effectiveLongThreshold += 4.0;
        effectiveShortThreshold += 4.0;
        break;
      case 'LOW_VOLATILITY':
        effectiveLongThreshold += 2.0;
        effectiveShortThreshold += 2.0;
        break;
      case 'WEAK_TREND':
        effectiveRr = params.baseTargetRr * 1.0;
        break;
      case 'TRANSITION':
      default:
        effectiveLongThreshold += 2.0;
        effectiveShortThreshold += 2.0;
        break;
    }
  }

  return {
    regime,
    effectiveStopMult,
    effectiveRr,
    effectiveLongThreshold,
    effectiveShortThreshold,
    description,
  };
}
