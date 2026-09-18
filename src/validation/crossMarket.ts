/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Cross-Market Robustness Validation Engine
 *
 * Evaluates strategy parameters across multiple non-correlated asset classes
 * (Crypto, Forex, Equities, Commodities) to verify edge portability.
 */

import { Candle, StrategyParameters, PerformanceMetrics } from '../strategy/types.js';
import { runBacktest } from '../backtest/backtester.js';

export interface MarketDataset {
  symbol: string;
  assetClass: 'Crypto' | 'Forex' | 'Equities' | 'Commodities';
  candles: Candle[];
}

export interface MarketEvaluationResult {
  symbol: string;
  assetClass: string;
  metrics: PerformanceMetrics;
  isPositiveExpectancy: boolean;
}

export interface CrossMarketRobustnessReport {
  results: MarketEvaluationResult[];
  totalMarkets: number;
  profitableMarketsCount: number;
  percentProfitableMarkets: number;
  averageSharpe: number;
  averageProfitFactor: number;
  averageWinRate: number;
  crossMarketRobustnessScore: number; // 0 - 100
  isCrossMarketRobust: boolean;
}

export function runCrossMarketValidation(
  datasets: MarketDataset[],
  params: StrategyParameters
): CrossMarketRobustnessReport {
  const results: MarketEvaluationResult[] = [];

  for (const ds of datasets) {
    const bt = runBacktest(ds.candles, params);
    results.push({
      symbol: ds.symbol,
      assetClass: ds.assetClass,
      metrics: bt.metrics,
      isPositiveExpectancy: bt.metrics.expectancy > 0 && bt.metrics.totalTrades >= 5,
    });
  }

  const totalMarkets = results.length;
  if (totalMarkets === 0) {
    return {
      results: [],
      totalMarkets: 0,
      profitableMarketsCount: 0,
      percentProfitableMarkets: 0,
      averageSharpe: 0,
      averageProfitFactor: 0,
      averageWinRate: 0,
      crossMarketRobustnessScore: 0,
      isCrossMarketRobust: false,
    };
  }

  const profitableMarketsCount = results.filter((r) => r.isPositiveExpectancy).length;
  const percentProfitableMarkets = (profitableMarketsCount / totalMarkets) * 100;

  const totalSharpe = results.reduce((sum, r) => sum + r.metrics.sharpeRatio, 0);
  const totalPf = results.reduce(
    (sum, r) => sum + (r.metrics.profitFactor > 10 ? 10 : r.metrics.profitFactor),
    0
  );
  const totalWr = results.reduce((sum, r) => sum + r.metrics.winRate, 0);

  const averageSharpe = totalSharpe / totalMarkets;
  const averageProfitFactor = totalPf / totalMarkets;
  const averageWinRate = (totalWr / totalMarkets) * 100;

  // Cross-Market Robustness Score (0 - 100)
  // Weighted combination of profitable market ratio, average Sharpe, and PF
  const scoreProfitable = percentProfitableMarkets * 0.4;
  const scoreSharpe = Math.min(30, Math.max(0, averageSharpe * 15));
  const scorePf = Math.min(30, Math.max(0, (averageProfitFactor - 1.0) * 30));
  const crossMarketRobustnessScore = Math.min(100, Math.max(0, scoreProfitable + scoreSharpe + scorePf));

  const isCrossMarketRobust =
    percentProfitableMarkets >= 60.0 && averageSharpe >= 0.70 && averageProfitFactor >= 1.20;

  return {
    results,
    totalMarkets,
    profitableMarketsCount,
    percentProfitableMarkets,
    averageSharpe,
    averageProfitFactor,
    averageWinRate,
    crossMarketRobustnessScore,
    isCrossMarketRobust,
  };
}
