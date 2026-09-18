/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Quantitative Backtester & Parameter Sweeper
 */

import {
  Candle,
  StrategyParameters,
  PerformanceMetrics,
  DEFAULT_STRATEGY_PARAMETERS,
  TradeRecord,
} from '../strategy/types.js';
import { runStrategyEngine, BacktestState } from '../strategy/engine.js';
import { calculatePerformanceMetrics } from './metrics.js';

export interface BacktestResult {
  params: StrategyParameters;
  metrics: PerformanceMetrics;
  trades: TradeRecord[];
  equityCurve: { time: number; equity: number }[];
}

export function runBacktest(
  candles: Candle[],
  params: Partial<StrategyParameters> = {}
): BacktestResult {
  const mergedParams: StrategyParameters = {
    ...DEFAULT_STRATEGY_PARAMETERS,
    ...params,
  };

  const state: BacktestState = runStrategyEngine(candles, mergedParams);
  const metrics = calculatePerformanceMetrics(
    state.trades,
    state.equityCurve,
    mergedParams.initialCapital,
    candles.length
  );

  return {
    params: mergedParams,
    metrics,
    trades: state.trades,
    equityCurve: state.equityCurve,
  };
}

export interface ParameterGrid {
  longThreshold?: number[];
  shortThreshold?: number[];
  baseAtrStopMult?: number[];
  baseTargetRr?: number[];
  minAdxTrendFilter?: number[];
  fastEmaLen?: number[];
  medEmaLen?: number[];
  slowEmaLen?: number[];
}

export interface SweepResult {
  bestBySharpe: BacktestResult;
  bestByProfitFactor: BacktestResult;
  bestByExpectancy: BacktestResult;
  allResults: BacktestResult[];
}

export function sweepParameters(
  candles: Candle[],
  baseParams: StrategyParameters,
  grid: ParameterGrid
): SweepResult {
  const allResults: BacktestResult[] = [];

  const longThresholds = grid.longThreshold ?? [baseParams.longThreshold];
  const shortThresholds = grid.shortThreshold ?? [baseParams.shortThreshold];
  const stopMults = grid.baseAtrStopMult ?? [baseParams.baseAtrStopMult];
  const targetRrs = grid.baseTargetRr ?? [baseParams.baseTargetRr];
  const adxFilters = grid.minAdxTrendFilter ?? [baseParams.minAdxTrendFilter];

  for (const lt of longThresholds) {
    for (const st of shortThresholds) {
      for (const sm of stopMults) {
        for (const rr of targetRrs) {
          for (const adx of adxFilters) {
            const currentParams: StrategyParameters = {
              ...baseParams,
              longThreshold: lt,
              shortThreshold: st,
              baseAtrStopMult: sm,
              baseTargetRr: rr,
              minAdxTrendFilter: adx,
            };

            const result = runBacktest(candles, currentParams);
            allResults.push(result);
          }
        }
      }
    }
  }

  // Filter runs with at least 5 trades to avoid zero-trade biases
  const validResults = allResults.filter((r) => r.metrics.totalTrades >= 5);
  const candidates = validResults.length > 0 ? validResults : allResults;

  let bestBySharpe = candidates[0];
  let bestByProfitFactor = candidates[0];
  let bestByExpectancy = candidates[0];

  for (const r of candidates) {
    if (r.metrics.sharpeRatio > bestBySharpe.metrics.sharpeRatio) {
      bestBySharpe = r;
    }
    if (r.metrics.profitFactor > bestByProfitFactor.metrics.profitFactor) {
      bestByProfitFactor = r;
    }
    if (r.metrics.expectancy > bestByExpectancy.metrics.expectancy) {
      bestByExpectancy = r;
    }
  }

  return {
    bestBySharpe,
    bestByProfitFactor,
    bestByExpectancy,
    allResults,
  };
}
