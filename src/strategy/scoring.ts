/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Multi-Factor Scoring Model
 *
 * Computes separate Long and Short quantitative scores normalized to 0 - 100
 * across 13 independent and semi-independent components.
 */

import { StrategyParameters, MarketRegimeType } from './types.js';

export interface FactorScores {
  scoreTrendLong: number;
  scoreTrendShort: number;
  scoreHtfLong: number;
  scoreHtfShort: number;
  scoreMomLong: number;
  scoreMomShort: number;
  scoreAdxLong: number;
  scoreAdxShort: number;
  scoreRsiRegimeLong: number;
  scoreRsiRegimeShort: number;
  scoreVwapLong: number;
  scoreVwapShort: number;
  scoreVolLong: number;
  scoreVolShort: number;
  scoreVolaLong: number;
  scoreVolaShort: number;
  scoreZLong: number;
  scoreZShort: number;
  scoreCurvLong: number;
  scoreCurvShort: number;
  scoreStructLong: number;
  scoreStructShort: number;
  scoreErLong: number;
  scoreErShort: number;

  compositeLongScore: number;
  compositeShortScore: number;
}

export interface BarIndicatorContext {
  close: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;

  safeAtr: number;
  atrPercentile: number;
  isVolSqueeze: boolean;

  emaFast: number;
  emaMed: number;
  emaSlow: number;
  hmaVal: number;
  prevEmaFast: number;
  prevEmaMed: number;
  prevEmaSlow: number;
  prevHmaVal: number;

  htfClose: number;
  htfFastEma: number;
  htfSlowEma: number;
  prevHtfFastEma: number;

  rsiVal: number;
  normMom: number;
  normMacdHist: number;
  prevNormMacdHist: number;
  distEmaMedAtr: number;

  diPlus: number;
  diMinus: number;
  adxVal: number;
  diSpreadNorm: number;

  safeVwap: number;
  prevVwap: number;
  distVwapAtr: number;

  rVol: number;
  cmfVal: number;

  zScore: number;
  priceCurvature: number;
  prevPriceCurvature: number;
  efficiencyRatio: number;

  bullishBos: boolean;
  bearishBos: boolean;
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
}

export function calculateBarFactorScores(
  ctx: BarIndicatorContext,
  params: StrategyParameters
): FactorScores {
  // 1. Trend Factor
  const bullishTrendAlign =
    ctx.close > ctx.emaFast && ctx.emaFast > ctx.emaMed && ctx.emaMed > ctx.emaSlow;
  const bearishTrendAlign =
    ctx.close < ctx.emaFast && ctx.emaFast < ctx.emaMed && ctx.emaMed < ctx.emaSlow;
  const fastSlopeUp = ctx.emaFast > ctx.prevEmaFast;
  const medSlopeUp = ctx.emaMed > ctx.prevEmaMed;
  const hmaSlopeUp = ctx.hmaVal > ctx.prevHmaVal;

  let scoreTrendLong = 0.0;
  let scoreTrendShort = 0.0;

  if (bullishTrendAlign) scoreTrendLong += 45.0;
  else if (ctx.close > ctx.emaMed && ctx.emaFast > ctx.emaMed) scoreTrendLong += 25.0;

  if (fastSlopeUp && medSlopeUp) scoreTrendLong += 25.0;
  else if (fastSlopeUp) scoreTrendLong += 10.0;

  if (hmaSlopeUp) scoreTrendLong += 15.0;
  if (ctx.close > ctx.emaFast) scoreTrendLong += 15.0;

  if (bearishTrendAlign) scoreTrendShort += 45.0;
  else if (ctx.close < ctx.emaMed && ctx.emaFast < ctx.emaMed) scoreTrendShort += 25.0;

  if (!fastSlopeUp && !medSlopeUp) scoreTrendShort += 25.0;
  else if (!fastSlopeUp) scoreTrendShort += 10.0;

  if (!hmaSlopeUp) scoreTrendShort += 15.0;
  if (ctx.close < ctx.emaFast) scoreTrendShort += 15.0;

  scoreTrendLong = Math.min(100.0, Math.max(0.0, scoreTrendLong));
  scoreTrendShort = Math.min(100.0, Math.max(0.0, scoreTrendShort));

  // 2. HTF Trend Factor
  let scoreHtfLong = 0.0;
  let scoreHtfShort = 0.0;
  const htfBullish =
    !isNaN(ctx.htfClose) &&
    ctx.htfClose > ctx.htfFastEma &&
    ctx.htfFastEma > ctx.htfSlowEma;
  const htfBearish =
    !isNaN(ctx.htfClose) &&
    ctx.htfClose < ctx.htfFastEma &&
    ctx.htfFastEma < ctx.htfSlowEma;
  const htfFastRising = !isNaN(ctx.htfFastEma) && ctx.htfFastEma > ctx.prevHtfFastEma;

  if (htfBullish) {
    scoreHtfLong += 60.0;
    if (htfFastRising) scoreHtfLong += 40.0;
  } else if (!isNaN(ctx.htfClose) && ctx.htfClose > ctx.htfFastEma) {
    scoreHtfLong += 30.0;
  }

  if (htfBearish) {
    scoreHtfShort += 60.0;
    if (!htfFastRising) scoreHtfShort += 40.0;
  } else if (!isNaN(ctx.htfClose) && ctx.htfClose < ctx.htfFastEma) {
    scoreHtfShort += 30.0;
  }

  scoreHtfLong = Math.min(100.0, Math.max(0.0, scoreHtfLong));
  scoreHtfShort = Math.min(100.0, Math.max(0.0, scoreHtfShort));

  // 3. Momentum Factor
  let scoreMomLong = 0.0;
  let scoreMomShort = 0.0;

  if (ctx.rsiVal > 50.0 && ctx.rsiVal < 75.0) scoreMomLong += 30.0;
  else if (ctx.rsiVal >= 75.0 && ctx.rsiVal <= 85.0) scoreMomLong += 15.0;

  if (ctx.normMom > 0.5) scoreMomLong += 25.0;
  else if (ctx.normMom > 0.0) scoreMomLong += 10.0;

  if (ctx.normMacdHist > 0.0) {
    scoreMomLong += 25.0;
    if (ctx.normMacdHist > ctx.prevNormMacdHist) scoreMomLong += 10.0;
  }

  if (ctx.distEmaMedAtr > 0.0 && ctx.distEmaMedAtr < 3.0) scoreMomLong += 10.0;

  if (ctx.rsiVal < 50.0 && ctx.rsiVal > 25.0) scoreMomShort += 30.0;
  else if (ctx.rsiVal <= 25.0 && ctx.rsiVal >= 15.0) scoreMomShort += 15.0;

  if (ctx.normMom < -0.5) scoreMomShort += 25.0;
  else if (ctx.normMom < 0.0) scoreMomShort += 10.0;

  if (ctx.normMacdHist < 0.0) {
    scoreMomShort += 25.0;
    if (ctx.normMacdHist < ctx.prevNormMacdHist) scoreMomShort += 10.0;
  }

  if (ctx.distEmaMedAtr < 0.0 && ctx.distEmaMedAtr > -3.0) scoreMomShort += 10.0;

  scoreMomLong = Math.min(100.0, Math.max(0.0, scoreMomLong));
  scoreMomShort = Math.min(100.0, Math.max(0.0, scoreMomShort));

  // 4. ADX / Directional Factor
  let scoreAdxLong = 0.0;
  let scoreAdxShort = 0.0;

  if (ctx.diPlus > ctx.diMinus) {
    scoreAdxLong += 40.0;
    if (ctx.diSpreadNorm > 0.2) scoreAdxLong += 20.0;
    if (ctx.adxVal >= params.adxTrendLevel) scoreAdxLong += 40.0;
    else if (ctx.adxVal >= 18.0) scoreAdxLong += 20.0;
  }

  if (ctx.diMinus > ctx.diPlus) {
    scoreAdxShort += 40.0;
    if (ctx.diSpreadNorm < -0.2) scoreAdxShort += 20.0;
    if (ctx.adxVal >= params.adxTrendLevel) scoreAdxShort += 40.0;
    else if (ctx.adxVal >= 18.0) scoreAdxShort += 20.0;
  }

  scoreAdxLong = Math.min(100.0, Math.max(0.0, scoreAdxLong));
  scoreAdxShort = Math.min(100.0, Math.max(0.0, scoreAdxShort));

  // 5. RSI Regime Factor (Cardwell range discipline)
  let scoreRsiRegimeLong = 0.0;
  let scoreRsiRegimeShort = 0.0;

  if (ctx.rsiVal >= 40.0 && ctx.rsiVal <= 80.0) {
    if (ctx.rsiVal >= 45.0 && ctx.rsiVal <= 65.0) scoreRsiRegimeLong = 100.0;
    else if (ctx.rsiVal > 65.0 && ctx.rsiVal <= 75.0) scoreRsiRegimeLong = 75.0;
    else if (ctx.rsiVal >= 40.0 && ctx.rsiVal < 45.0) scoreRsiRegimeLong = 80.0;
  }

  if (ctx.rsiVal >= 20.0 && ctx.rsiVal <= 60.0) {
    if (ctx.rsiVal >= 35.0 && ctx.rsiVal <= 55.0) scoreRsiRegimeShort = 100.0;
    else if (ctx.rsiVal >= 25.0 && ctx.rsiVal < 35.0) scoreRsiRegimeShort = 75.0;
    else if (ctx.rsiVal > 55.0 && ctx.rsiVal <= 60.0) scoreRsiRegimeShort = 80.0;
  }

  // 6. VWAP Relationship
  let scoreVwapLong = 0.0;
  let scoreVwapShort = 0.0;
  const vwapSlopeUp = ctx.safeVwap >= ctx.prevVwap;

  if (ctx.close > ctx.safeVwap) {
    scoreVwapLong += 50.0;
    if (vwapSlopeUp) scoreVwapLong += 30.0;
    if (ctx.distVwapAtr > 0.1 && ctx.distVwapAtr < 2.5) scoreVwapLong += 20.0;
  }

  if (ctx.close < ctx.safeVwap) {
    scoreVwapShort += 50.0;
    if (!vwapSlopeUp) scoreVwapShort += 30.0;
    if (ctx.distVwapAtr < -0.1 && ctx.distVwapAtr > -2.5) scoreVwapShort += 20.0;
  }

  scoreVwapLong = Math.min(100.0, Math.max(0.0, scoreVwapLong));
  scoreVwapShort = Math.min(100.0, Math.max(0.0, scoreVwapShort));

  // 7. Volume Confirmation & CMF
  let scoreVolLong = 0.0;
  let scoreVolShort = 0.0;

  if (ctx.rVol >= 1.0) {
    scoreVolLong += 40.0;
    if (ctx.rVol >= 1.5) scoreVolLong += 20.0;
    if (ctx.cmfVal > 0.05) scoreVolLong += 40.0;
    else if (ctx.cmfVal > 0.0) scoreVolLong += 20.0;
  } else if (ctx.rVol >= 0.7 && ctx.cmfVal > 0.0) {
    scoreVolLong += 30.0;
  }

  if (ctx.rVol >= 1.0) {
    scoreVolShort += 40.0;
    if (ctx.rVol >= 1.5) scoreVolShort += 20.0;
    if (ctx.cmfVal < -0.05) scoreVolShort += 40.0;
    else if (ctx.cmfVal < 0.0) scoreVolShort += 20.0;
  } else if (ctx.rVol >= 0.7 && ctx.cmfVal < 0.0) {
    scoreVolShort += 30.0;
  }

  scoreVolLong = Math.min(100.0, Math.max(0.0, scoreVolLong));
  scoreVolShort = Math.min(100.0, Math.max(0.0, scoreVolShort));

  // 8. Volatility Score (Normalized relative to percentile)
  const scoreVolaLong = Math.min(100.0, Math.max(0.0, 100.0 - ctx.atrPercentile + (ctx.isVolSqueeze ? 50.0 : 0.0)));
  const scoreVolaShort = scoreVolaLong;

  // 9. Z-Score Factor (Contextual)
  let scoreZLong = 0.0;
  let scoreZShort = 0.0;

  if (ctx.adxVal >= 20.0) {
    if (ctx.zScore >= 0.3 && ctx.zScore <= 2.0) scoreZLong = 85.0;
    else if (ctx.zScore > 2.0 && ctx.zScore <= 2.8) scoreZLong = 50.0;
    else if (ctx.zScore < -0.2 && ctx.zScore > -1.5 && bullishTrendAlign) scoreZLong = 75.0;

    if (ctx.zScore <= -0.3 && ctx.zScore >= -2.0) scoreZShort = 85.0;
    else if (ctx.zScore < -2.0 && ctx.zScore >= -2.8) scoreZShort = 50.0;
    else if (ctx.zScore > 0.2 && ctx.zScore < 1.5 && bearishTrendAlign) scoreZShort = 75.0;
  } else {
    if (ctx.zScore <= -params.zScoreReversionBand) scoreZLong = 90.0;
    else if (ctx.zScore <= -1.0) scoreZLong = 60.0;

    if (ctx.zScore >= params.zScoreReversionBand) scoreZShort = 90.0;
    else if (ctx.zScore >= 1.0) scoreZShort = 60.0;
  }

  // 10. Price Curvature (2nd Derivative Acceleration)
  let scoreCurvLong = 0.0;
  let scoreCurvShort = 0.0;

  if (ctx.priceCurvature > 0.1) {
    scoreCurvLong += 50.0;
    if (ctx.priceCurvature > 0.3) scoreCurvLong += 30.0;
    if (ctx.priceCurvature > ctx.prevPriceCurvature) scoreCurvLong += 20.0;
  } else if (ctx.priceCurvature > 0.0) {
    scoreCurvLong += 30.0;
  }

  if (ctx.priceCurvature < -0.1) {
    scoreCurvShort += 50.0;
    if (ctx.priceCurvature < -0.3) scoreCurvShort += 30.0;
    if (ctx.priceCurvature < ctx.prevPriceCurvature) scoreCurvShort += 20.0;
  } else if (ctx.priceCurvature < 0.0) {
    scoreCurvShort += 30.0;
  }

  scoreCurvLong = Math.min(100.0, Math.max(0.0, scoreCurvLong));
  scoreCurvShort = Math.min(100.0, Math.max(0.0, scoreCurvShort));

  // 11. Market Structure Factor (BOS & Swing Pivots)
  let scoreStructLong = 0.0;
  let scoreStructShort = 0.0;

  if (ctx.bullishBos) scoreStructLong += 50.0;
  if (ctx.higherHighs) scoreStructLong += 25.0;
  if (ctx.higherLows) scoreStructLong += 25.0;

  if (ctx.bearishBos) scoreStructShort += 50.0;
  if (ctx.lowerHighs) scoreStructShort += 25.0;
  if (ctx.lowerLows) scoreStructShort += 25.0;

  scoreStructLong = Math.min(100.0, Math.max(0.0, scoreStructLong));
  scoreStructShort = Math.min(100.0, Math.max(0.0, scoreStructShort));

  // 12. Kaufman Efficiency Ratio
  let scoreErLong = 20.0;
  let scoreErShort = 20.0;

  if (ctx.efficiencyRatio >= 0.5) {
    if (ctx.close > ctx.prevClose) scoreErLong = 100.0;
    else scoreErShort = 100.0;
  } else if (ctx.efficiencyRatio >= 0.3) {
    if (ctx.close > ctx.prevClose) scoreErLong = 60.0;
    else scoreErShort = 60.0;
  }

  // Composite Weighted Aggregation
  const sumWeights =
    params.w_trend +
    params.w_htf +
    params.w_mom +
    params.w_adx +
    params.w_rsiRegime +
    params.w_vwap +
    params.w_volume +
    params.w_volatility +
    params.w_zScore +
    params.w_curvature +
    params.w_structure +
    params.w_er;

  const safeSumWeights = sumWeights <= 0 ? 1.0 : sumWeights;

  const rawLongScore =
    (scoreTrendLong * params.w_trend +
      scoreHtfLong * params.w_htf +
      scoreMomLong * params.w_mom +
      scoreAdxLong * params.w_adx +
      scoreRsiRegimeLong * params.w_rsiRegime +
      scoreVwapLong * params.w_vwap +
      scoreVolLong * params.w_volume +
      scoreVolaLong * params.w_volatility +
      scoreZLong * params.w_zScore +
      scoreCurvLong * params.w_curvature +
      scoreStructLong * params.w_structure +
      scoreErLong * params.w_er) /
    safeSumWeights;

  const rawShortScore =
    (scoreTrendShort * params.w_trend +
      scoreHtfShort * params.w_htf +
      scoreMomShort * params.w_mom +
      scoreAdxShort * params.w_adx +
      scoreRsiRegimeShort * params.w_rsiRegime +
      scoreVwapShort * params.w_vwap +
      scoreVolShort * params.w_volume +
      scoreVolaShort * params.w_volatility +
      scoreZShort * params.w_zScore +
      scoreCurvShort * params.w_curvature +
      scoreStructShort * params.w_structure +
      scoreErShort * params.w_er) /
    safeSumWeights;

  const compositeLongScore = Math.min(100.0, Math.max(0.0, rawLongScore));
  const compositeShortScore = Math.min(100.0, Math.max(0.0, rawShortScore));

  return {
    scoreTrendLong,
    scoreTrendShort,
    scoreHtfLong,
    scoreHtfShort,
    scoreMomLong,
    scoreMomShort,
    scoreAdxLong,
    scoreAdxShort,
    scoreRsiRegimeLong,
    scoreRsiRegimeShort,
    scoreVwapLong,
    scoreVwapShort,
    scoreVolLong,
    scoreVolShort,
    scoreVolaLong,
    scoreVolaShort,
    scoreZLong,
    scoreZShort,
    scoreCurvLong,
    scoreCurvShort,
    scoreStructLong,
    scoreStructShort,
    scoreErLong,
    scoreErShort,
    compositeLongScore,
    compositeShortScore,
  };
}
