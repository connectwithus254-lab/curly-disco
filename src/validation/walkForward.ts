/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Walk-Forward Optimization & Validation Engine
 *
 * Implements rolling In-Sample (Train) and Out-Of-Sample (Test) windows
 * to eliminate lookahead bias and verify statistical robustness.
 */

import { Candle, StrategyParameters, PerformanceMetrics, TradeRecord } from '../strategy/types.js';
import { runBacktest, ParameterGrid, sweepParameters } from '../backtest/backtester.js';
import { calculatePerformanceMetrics } from '../backtest/metrics.js';

export interface WalkForwardWindow {
  windowIndex: number;
  trainStartTime: number;
  trainEndTime: number;
  testStartTime: number;
  testEndTime: number;
  trainMetrics: PerformanceMetrics;
  testMetrics: PerformanceMetrics;
  optimalParams: StrategyParameters;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  concatenatedOosTrades: TradeRecord[];
  overallOosMetrics: PerformanceMetrics;
  walkForwardEfficiency: number; // Ratio of OOS Sharpe to IS Sharpe
  isRobust: boolean;
}

export function runWalkForwardAnalysis(
  candles: Candle[],
  baseParams: StrategyParameters,
  grid: ParameterGrid,
  numWindows: number = 4,
  trainRatio: number = 0.70
): WalkForwardResult {
  const totalBars = candles.length;
  const windowSize = Math.floor(totalBars / numWindows);
  const trainBars = Math.floor(windowSize * trainRatio);
  const testBars = windowSize - trainBars;

  const windows: WalkForwardWindow[] = [];
  const concatenatedOosTrades: TradeRecord[] = [];
  let currentOosEquity = baseParams.initialCapital;
  const concatenatedOosEquityCurve: { time: number; equity: number }[] = [];

  for (let w = 0; w < numWindows; w++) {
    const startIndex = w * testBars;
    const trainEndIndex = Math.min(totalBars, startIndex + trainBars);
    const testEndIndex = Math.min(totalBars, trainEndIndex + testBars);

    if (testEndIndex - trainEndIndex < 30) {
      break;
    }

    const trainCandles = candles.slice(startIndex, trainEndIndex);
    // Include warmup bars from training window for indicator continuity
    const warmupCount = Math.min(trainCandles.length, 200);
    const testWithWarmup = candles.slice(trainEndIndex - warmupCount, testEndIndex);

    // 1. Optimize on In-Sample (Train)
    const sweep = sweepParameters(trainCandles, baseParams, grid);
    const bestTrain = sweep.bestBySharpe;

    // 2. Validate on Out-Of-Sample (Test) strictly using the selected parameters
    const testResult = runBacktest(testWithWarmup, bestTrain.params);
    const testStartTime = candles[trainEndIndex].time;

    // Only collect trades whose entry occurred in the true Out-Of-Sample window
    const oosTrades = testResult.trades.filter((t) => t.entryTime >= testStartTime);

    for (const trade of oosTrades) {
      concatenatedOosTrades.push(trade);
      currentOosEquity += trade.realizedPnlCash;
      concatenatedOosEquityCurve.push({
        time: trade.exitTime,
        equity: currentOosEquity,
      });
    }

    const oosMetrics = calculatePerformanceMetrics(
      oosTrades,
      testResult.equityCurve.filter((pt) => pt.time >= testStartTime),
      bestTrain.params.initialCapital,
      testEndIndex - trainEndIndex
    );

    windows.push({
      windowIndex: w + 1,
      trainStartTime: trainCandles[0].time,
      trainEndTime: trainCandles[trainCandles.length - 1].time,
      testStartTime: candles[trainEndIndex].time,
      testEndTime: candles[testEndIndex - 1].time,
      trainMetrics: bestTrain.metrics,
      testMetrics: oosMetrics,
      optimalParams: bestTrain.params,
    });
  }

  // Calculate Overall OOS Metrics
  const overallOosMetrics = calculatePerformanceMetrics(
    concatenatedOosTrades,
    concatenatedOosEquityCurve.length > 0
      ? concatenatedOosEquityCurve
      : [{ time: candles[0].time, equity: baseParams.initialCapital }],
    baseParams.initialCapital,
    totalBars
  );

  // Walk-Forward Efficiency (WFE): Average OOS Sharpe / Average IS Sharpe
  let totalIsSharpe = 0;
  let totalOosSharpe = 0;
  for (const win of windows) {
    totalIsSharpe += Math.max(0, win.trainMetrics.sharpeRatio);
    totalOosSharpe += Math.max(0, win.testMetrics.sharpeRatio);
  }
  const avgIsSharpe = windows.length > 0 ? totalIsSharpe / windows.length : 1;
  const avgOosSharpe = windows.length > 0 ? totalOosSharpe / windows.length : 0;
  const walkForwardEfficiency = avgIsSharpe > 0 ? avgOosSharpe / avgIsSharpe : 0;

  // A system is considered robust if WFE >= 0.50 and overall OOS expectancy is positive
  const isRobust = walkForwardEfficiency >= 0.50 && overallOosMetrics.expectancy > 0;

  return {
    windows,
    concatenatedOosTrades,
    overallOosMetrics,
    walkForwardEfficiency,
    isRobust,
  };
}
