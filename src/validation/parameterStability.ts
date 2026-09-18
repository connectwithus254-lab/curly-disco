/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Parameter Stability & Overfitting Detection Engine
 *
 * Checks if optimal parameter configurations lie on a stable performance plateau
 * rather than an isolated, overfitted razor-edge spike.
 */

import { Candle, StrategyParameters } from '../strategy/types.js';
import { runBacktest, BacktestResult } from '../backtest/backtester.js';

export interface StabilityNeighborhoodPoint {
  stopMult: number;
  longThreshold: number;
  targetRr: number;
  sharpeRatio: number;
  profitFactor: number;
  expectancy: number;
  winRate: number;
}

export interface ParameterStabilityReport {
  basePoint: StabilityNeighborhoodPoint;
  neighborhood: StabilityNeighborhoodPoint[];
  sharpeMean: number;
  sharpeStd: number;
  sharpeCv: number; // Coefficient of Variation (Std / Mean)
  profitFactorMean: number;
  profitFactorStd: number;
  isStablePlateau: boolean;
  stabilityClassification: 'BROAD_PLATEAU' | 'MODERATE_SLOPE' | 'OVERFITTED_SPIKE';
  warningMessage?: string;
}

export function evaluateParameterStability(
  candles: Candle[],
  baseParams: StrategyParameters,
  stopMultPerturbations: number[] = [-0.3, 0.0, 0.3],
  thresholdPerturbations: number[] = [-4.0, 0.0, 4.0],
  rrPerturbations: number[] = [-0.25, 0.0, 0.25]
): ParameterStabilityReport {
  const neighborhood: StabilityNeighborhoodPoint[] = [];

  for (const dStop of stopMultPerturbations) {
    for (const dThresh of thresholdPerturbations) {
      for (const dRr of rrPerturbations) {
        const testParams: StrategyParameters = {
          ...baseParams,
          baseAtrStopMult: Math.max(0.5, baseParams.baseAtrStopMult + dStop),
          longThreshold: Math.min(95, Math.max(40, baseParams.longThreshold + dThresh)),
          shortThreshold: Math.min(95, Math.max(40, baseParams.shortThreshold + dThresh)),
          baseTargetRr: Math.max(0.5, baseParams.baseTargetRr + dRr),
        };

        const result: BacktestResult = runBacktest(candles, testParams);
        neighborhood.push({
          stopMult: testParams.baseAtrStopMult,
          longThreshold: testParams.longThreshold,
          targetRr: testParams.baseTargetRr,
          sharpeRatio: result.metrics.sharpeRatio,
          profitFactor: result.metrics.profitFactor,
          expectancy: result.metrics.expectancy,
          winRate: result.metrics.winRate,
        });
      }
    }
  }

  // Base Point
  const baseResult = runBacktest(candles, baseParams);
  const basePoint: StabilityNeighborhoodPoint = {
    stopMult: baseParams.baseAtrStopMult,
    longThreshold: baseParams.longThreshold,
    targetRr: baseParams.baseTargetRr,
    sharpeRatio: baseResult.metrics.sharpeRatio,
    profitFactor: baseResult.metrics.profitFactor,
    expectancy: baseResult.metrics.expectancy,
    winRate: baseResult.metrics.winRate,
  };

  // Neighborhood Statistics
  const sharpeValues = neighborhood.map((n) => n.sharpeRatio);
  const pfValues = neighborhood.map((n) => (n.profitFactor > 10 ? 10 : n.profitFactor));

  const sharpeMean = sharpeValues.reduce((a, b) => a + b, 0) / sharpeValues.length;
  const sharpeVariance =
    sharpeValues.reduce((sum, v) => sum + (v - sharpeMean) ** 2, 0) /
    Math.max(1, sharpeValues.length - 1);
  const sharpeStd = Math.sqrt(sharpeVariance);
  const sharpeCv = Math.abs(sharpeMean) > 0 ? sharpeStd / Math.abs(sharpeMean) : 999;

  const pfMean = pfValues.reduce((a, b) => a + b, 0) / pfValues.length;
  const pfVariance =
    pfValues.reduce((sum, v) => sum + (v - pfMean) ** 2, 0) /
    Math.max(1, pfValues.length - 1);
  const pfStd = Math.sqrt(pfVariance);

  let stabilityClassification: 'BROAD_PLATEAU' | 'MODERATE_SLOPE' | 'OVERFITTED_SPIKE' =
    'MODERATE_SLOPE';
  let isStablePlateau = false;
  let warningMessage: string | undefined;

  if (sharpeCv < 0.35 && sharpeMean > 0.8 && pfMean > 1.25) {
    stabilityClassification = 'BROAD_PLATEAU';
    isStablePlateau = true;
  } else if (sharpeCv > 0.75 || basePoint.sharpeRatio > sharpeMean * 2.2) {
    stabilityClassification = 'OVERFITTED_SPIKE';
    isStablePlateau = false;
    warningMessage =
      'CRITICAL WARNING: The selected parameter set exhibits high sensitivity to small perturbations. Performance drops drastically on adjacent parameter values, indicating curve-fitting / data snooping.';
  } else {
    stabilityClassification = 'MODERATE_SLOPE';
    isStablePlateau = sharpeMean > 0.5;
  }

  return {
    basePoint,
    neighborhood,
    sharpeMean,
    sharpeStd,
    sharpeCv,
    profitFactorMean: pfMean,
    profitFactorStd: pfStd,
    isStablePlateau,
    stabilityClassification,
    warningMessage,
  };
}
