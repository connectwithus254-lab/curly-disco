import { describe, it, expect } from 'vitest';
import { evaluateMarketRegime } from '../src/strategy/regime.js';
import { calculateBarFactorScores, BarIndicatorContext } from '../src/strategy/scoring.js';
import { DEFAULT_STRATEGY_PARAMETERS } from '../src/strategy/types.js';

describe('Market Regime Engine', () => {
  it('classifies High Volatility when ATR percentile >= 80', () => {
    const evalRes = evaluateMarketRegime(
      20, // ADX
      0.2, // ER
      0.5, // trendDist
      85, // atrPercentile
      60, // bbwPercentile
      false, // isVolSqueeze
      false,
      false,
      DEFAULT_STRATEGY_PARAMETERS
    );
    expect(evalRes.regime).toBe('HIGH_VOLATILITY');
    expect(evalRes.effectiveStopMult).toBeGreaterThan(DEFAULT_STRATEGY_PARAMETERS.baseAtrStopMult);
  });

  it('classifies Low Volatility / Squeeze when bbw and atr percentiles are compressed', () => {
    const evalRes = evaluateMarketRegime(
      15,
      0.15,
      0.2,
      15, // atrPercentile
      15, // bbwPercentile
      true, // isVolSqueeze
      false,
      false,
      DEFAULT_STRATEGY_PARAMETERS
    );
    expect(evalRes.regime).toBe('LOW_VOLATILITY');
  });

  it('classifies Strong Trend when ADX is elevated and efficiency ratio is high', () => {
    const evalRes = evaluateMarketRegime(
      32, // ADX
      0.55, // ER
      1.8, // trendDistAtr
      50,
      50,
      false,
      true, // bullishTrendAlign
      false,
      DEFAULT_STRATEGY_PARAMETERS
    );
    expect(evalRes.regime).toBe('STRONG_TREND');
    expect(evalRes.effectiveRr).toBeGreaterThan(DEFAULT_STRATEGY_PARAMETERS.baseTargetRr);
    expect(evalRes.effectiveLongThreshold).toBeLessThan(DEFAULT_STRATEGY_PARAMETERS.longThreshold);
  });

  it('classifies Range when ADX is low and efficiency ratio is low', () => {
    const evalRes = evaluateMarketRegime(
      14, // low ADX
      0.18, // low ER
      0.3,
      50,
      50,
      false,
      false,
      false,
      DEFAULT_STRATEGY_PARAMETERS
    );
    expect(evalRes.regime).toBe('RANGE');
    expect(evalRes.effectiveRr).toBeLessThan(DEFAULT_STRATEGY_PARAMETERS.baseTargetRr);
  });
});

describe('Multi-Factor Scoring Model', () => {
  const dummyCtx: BarIndicatorContext = {
    close: 100,
    prevClose: 99,
    high: 101,
    low: 98,
    volume: 1000,
    safeAtr: 2.0,
    atrPercentile: 50,
    isVolSqueeze: false,
    emaFast: 101,
    emaMed: 99,
    emaSlow: 95,
    hmaVal: 102,
    prevEmaFast: 100,
    prevEmaMed: 98.5,
    prevEmaSlow: 94.8,
    prevHmaVal: 101,
    htfClose: 100.5,
    htfFastEma: 99,
    htfSlowEma: 96,
    prevHtfFastEma: 98.5,
    rsiVal: 58,
    normMom: 0.8,
    normMacdHist: 0.3,
    prevNormMacdHist: 0.2,
    distEmaMedAtr: 0.5,
    diPlus: 28,
    diMinus: 14,
    adxVal: 26,
    diSpreadNorm: 0.33,
    safeVwap: 99.2,
    prevVwap: 99.0,
    distVwapAtr: 0.4,
    rVol: 1.2,
    cmfVal: 0.12,
    zScore: 0.7,
    priceCurvature: 0.25,
    prevPriceCurvature: 0.15,
    efficiencyRatio: 0.52,
    bullishBos: true,
    bearishBos: false,
    higherHighs: true,
    higherLows: true,
    lowerHighs: false,
    lowerLows: false,
  };

  it('computes composite Long and Short scores normalized strictly in [0, 100]', () => {
    const scores = calculateBarFactorScores(dummyCtx, DEFAULT_STRATEGY_PARAMETERS);
    expect(scores.compositeLongScore).toBeGreaterThanOrEqual(0);
    expect(scores.compositeLongScore).toBeLessThanOrEqual(100);
    expect(scores.compositeShortScore).toBeGreaterThanOrEqual(0);
    expect(scores.compositeShortScore).toBeLessThanOrEqual(100);
  });

  it('produces higher Long score than Short score in a strongly bullish context', () => {
    const scores = calculateBarFactorScores(dummyCtx, DEFAULT_STRATEGY_PARAMETERS);
    expect(scores.compositeLongScore).toBeGreaterThan(scores.compositeShortScore);
    expect(scores.compositeLongScore).toBeGreaterThan(65);
  });
});
