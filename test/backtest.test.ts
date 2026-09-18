import { describe, it, expect } from 'vitest';
import { runBacktest, sweepParameters } from '../src/backtest/backtester.js';
import { calculatePerformanceMetrics } from '../src/backtest/metrics.js';
import { generateSyntheticMarket } from '../src/data/syntheticProvider.js';
import { DEFAULT_STRATEGY_PARAMETERS, TradeRecord } from '../src/strategy/types.js';
import { runWalkForwardAnalysis } from '../src/validation/walkForward.js';
import { runMonteCarloSimulation } from '../src/validation/monteCarlo.js';
import { evaluateParameterStability } from '../src/validation/parameterStability.js';

describe('Backtest & Metrics Engine', () => {
  const candles = generateSyntheticMarket({
    bars: 800,
    startPrice: 50000,
    baseVolDailyPct: 3.0,
    seed: 42,
    timeframeMinutes: 15,
  });

  it('runs backtest and outputs structured trade records and metrics', () => {
    const res = runBacktest(candles, DEFAULT_STRATEGY_PARAMETERS);
    expect(res.trades).toBeInstanceOf(Array);
    expect(res.equityCurve.length).toBeGreaterThan(0);
    expect(res.metrics.finalEquity).toBeGreaterThan(0);
    expect(res.metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(res.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(res.metrics.winRate).toBeLessThanOrEqual(1.0);
    if (res.trades.length > 0) {
      expect(typeof res.trades[0].entryReason).toBe('string');
    }
  });

  it('supports Extremum Reversals execution mode for bottom and top turning points', () => {
    const extremumParams = {
      ...DEFAULT_STRATEGY_PARAMETERS,
      executionStyle: 'Extremum Reversals' as const,
      enableExtremumEngine: true,
      extremumZThreshold: 1.2,
      minRejectionWickPct: 15.0,
      longThreshold: 55.0,
      shortThreshold: 55.0,
    };
    const res = runBacktest(candles, extremumParams);
    expect(res.trades).toBeInstanceOf(Array);
    expect(res.metrics.finalEquity).toBeGreaterThan(0);
  });

  it('supports News Catalyst engine with Fade Overreaction and Ride Momentum modes', () => {
    const newsFadeParams = {
      ...DEFAULT_STRATEGY_PARAMETERS,
      enableNewsEngine: true,
      newsMode: 'Fade Overreaction' as const,
      newsVolThreshold: 1.5,
      newsAtrExpansion: 1.2,
    };
    const resFade = runBacktest(candles, newsFadeParams);
    expect(resFade.trades).toBeInstanceOf(Array);

    const newsMomentumParams = {
      ...DEFAULT_STRATEGY_PARAMETERS,
      enableNewsEngine: true,
      newsMode: 'Ride Momentum' as const,
      newsVolThreshold: 1.5,
      newsAtrExpansion: 1.2,
      externalNewsSentiment: 50.0,
    };
    const resMom = runBacktest(candles, newsMomentumParams);
    expect(resMom.trades).toBeInstanceOf(Array);
  });

  it('calculates metrics accurately for dummy trade history', () => {
    const mockTrades: TradeRecord[] = [
      {
        id: 1,
        direction: 'LONG',
        entryTime: 1000,
        entryBar: 10,
        entryPrice: 100,
        exitTime: 2000,
        exitBar: 20,
        exitPrice: 105,
        qty: 10,
        initialStop: 97,
        initialTarget: 106,
        realizedPnlCash: 50,
        realizedPnlPct: 5,
        exitReason: 'TAKE_PROFIT',
        holdingBars: 10,
        rMultiple: 1.66,
        entryRegime: 'STRONG_TREND',
        entryScore: 78,
      },
      {
        id: 2,
        direction: 'SHORT',
        entryTime: 3000,
        entryBar: 30,
        entryPrice: 105,
        exitTime: 4000,
        exitBar: 40,
        exitPrice: 107,
        qty: 10,
        initialStop: 107,
        initialTarget: 101,
        realizedPnlCash: -20,
        realizedPnlPct: -1.9,
        exitReason: 'STOP_LOSS',
        holdingBars: 10,
        rMultiple: -1.0,
        entryRegime: 'RANGE',
        entryScore: 72,
      },
    ];

    const mockEquity = [
      { time: 1000, equity: 1000 },
      { time: 2000, equity: 1050 },
      { time: 3000, equity: 1050 },
      { time: 4000, equity: 1030 },
    ];

    const metrics = calculatePerformanceMetrics(mockTrades, mockEquity, 1000, 100);
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.profitFactor).toBe(2.5); // 50 / 20
    expect(metrics.expectancy).toBe(15); // (0.5 * 50) - (0.5 * 20)
    expect(metrics.finalEquity).toBe(1030);
  });
});

describe('Walk-Forward, Monte Carlo & Stability Suite', () => {
  const candles = generateSyntheticMarket({
    bars: 1000,
    startPrice: 65000,
    baseVolDailyPct: 3.5,
    seed: 42,
    timeframeMinutes: 15,
  });

  it('runs Walk-Forward analysis across multiple windows', () => {
    const grid = {
      longThreshold: [68, 72],
      baseAtrStopMult: [1.8, 2.2],
    };
    const wf = runWalkForwardAnalysis(candles, DEFAULT_STRATEGY_PARAMETERS, grid, 3, 0.70);
    expect(wf.windows.length).toBeGreaterThan(0);
    expect(typeof wf.walkForwardEfficiency).toBe('number');
  });

  it('runs Monte Carlo simulation and calculates risk distributions', () => {
    const bt = runBacktest(candles, DEFAULT_STRATEGY_PARAMETERS);
    const mc = runMonteCarloSimulation(bt.trades, 100000, 200, 50);
    expect(mc.iterations).toBe(200);
    expect(mc.medianMaxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(mc.p95MaxDrawdownPct).toBeGreaterThanOrEqual(mc.medianMaxDrawdownPct);
    expect(mc.p99MaxDrawdownPct).toBeGreaterThanOrEqual(mc.p95MaxDrawdownPct);
  });

  it('evaluates parameter stability neighborhood without error', () => {
    const report = evaluateParameterStability(
      candles.slice(0, 500),
      DEFAULT_STRATEGY_PARAMETERS,
      [-0.2, 0.2],
      [-2, 2],
      [0.0]
    );
    expect(report.neighborhood.length).toBe(4);
    expect(typeof report.sharpeMean).toBe('number');
    expect(typeof report.sharpeCv).toBe('number');
  });
});
