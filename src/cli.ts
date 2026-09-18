#!/usr/bin/env node
/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Quantitative Research, Backtesting & Validation CLI
 */

import { generateSyntheticMarket, getPresetMarketDatasets } from './data/syntheticProvider.js';
import { runBacktest, sweepParameters } from './backtest/backtester.js';
import { runWalkForwardAnalysis } from './validation/walkForward.js';
import { runMonteCarloSimulation } from './validation/monteCarlo.js';
import { evaluateParameterStability } from './validation/parameterStability.js';
import { runCrossMarketValidation } from './validation/crossMarket.js';
import { PineTsBridge } from './pinets/pinetsBridge.js';
import { DEFAULT_STRATEGY_PARAMETERS } from './strategy/types.js';

function formatPct(val: number): string {
  return (val).toFixed(2) + '%';
}

function formatNum(val: number): string {
  return (val).toFixed(2);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'backtest';

  console.log('========================================================================');
  console.log('  ADAPTIVE QUANTITATIVE MARKET REGIME STRATEGY (AQMRS)');
  console.log('  Quantitative Backtesting, Research & Validation Engine');
  console.log('========================================================================\n');

  if (command === 'backtest') {
    console.log('[*] Generating synthetic multi-regime market dataset (1,200 bars)...');
    const candles = generateSyntheticMarket({
      bars: 1200,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 42,
      timeframeMinutes: 15,
    });

    console.log('[*] Executing bar-by-bar AQMRS Strategy Engine with slippage & commission...');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMETERS);
    const m = result.metrics;

    console.log('\n---------------------- PERFORMANCE METRICS ----------------------');
    console.log(`Total Trades:            ${m.totalTrades}`);
    console.log(`Winning / Losing Trades: ${m.winningTrades} / ${m.losingTrades} (${m.breakEvenTrades} Break-Even)`);
    console.log(`Win Rate:                ${formatPct(m.winRate * 100)}`);
    console.log(`Profit Factor:           ${formatNum(m.profitFactor)}`);
    console.log(`Expectancy ($ / trade):  $${formatNum(m.expectancy)}`);
    console.log(`Expectancy Ratio (E/R):  ${formatNum(m.expectancyRatio)}`);
    console.log(`Annualized Sharpe Ratio: ${formatNum(m.sharpeRatio)}`);
    console.log(`Annualized Sortino:      ${formatNum(m.sortinoRatio)}`);
    console.log(`Max Drawdown ($):        $${formatNum(m.maxDrawdownCash)}`);
    console.log(`Max Drawdown (%):        ${formatPct(m.maxDrawdownPercent)}`);
    console.log(`Net Profit ($):          $${formatNum(m.netProfitCash)} (${formatPct(m.netProfitPercent)})`);
    console.log(`Final Equity:            $${formatNum(m.finalEquity)}`);
    console.log(`CAGR:                    ${formatPct(m.cagr)}`);
    console.log(`Calmar Ratio:            ${formatNum(m.calmarRatio)}`);
    console.log(`Market Exposure:         ${formatPct(m.marketExposurePercent)}`);
    console.log(`Longest Losing Streak:   ${m.longestLosingStreak}`);
    console.log('-------------------------------------------------------------------\n');

  } else if (command === 'optimize') {
    console.log('[*] Generating training market data (1,000 bars)...');
    const candles = generateSyntheticMarket({
      bars: 1000,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 55,
      timeframeMinutes: 15,
    });

    console.log('[*] Sweeping parameter grid for Sharpe & Profit Factor...');
    const grid = {
      longThreshold: [65, 70, 75],
      shortThreshold: [65, 70, 75],
      baseAtrStopMult: [1.8, 2.0, 2.4],
      baseTargetRr: [1.8, 2.0, 2.5],
    };

    const sweep = sweepParameters(candles, DEFAULT_STRATEGY_PARAMETERS, grid);
    console.log(`[*] Evaluated ${sweep.allResults.length} parameter permutations.`);

    console.log('\n--- BEST PARAMETERS BY ANNUALIZED SHARPE RATIO ---');
    console.log(`Long Threshold:   ${sweep.bestBySharpe.params.longThreshold}`);
    console.log(`Short Threshold:  ${sweep.bestBySharpe.params.shortThreshold}`);
    console.log(`ATR Stop Mult:    ${sweep.bestBySharpe.params.baseAtrStopMult}`);
    console.log(`Target R:R:       ${sweep.bestBySharpe.params.baseTargetRr}`);
    console.log(`Trades:           ${sweep.bestBySharpe.metrics.totalTrades}`);
    console.log(`Sharpe:           ${formatNum(sweep.bestBySharpe.metrics.sharpeRatio)}`);
    console.log(`Profit Factor:    ${formatNum(sweep.bestBySharpe.metrics.profitFactor)}`);
    console.log(`Win Rate:         ${formatPct(sweep.bestBySharpe.metrics.winRate * 100)}`);
    console.log(`Max Drawdown:     ${formatPct(sweep.bestBySharpe.metrics.maxDrawdownPercent)}\n`);

  } else if (command === 'walkforward') {
    console.log('[*] Running Walk-Forward Optimization (4 rolling windows, 70/30 Train/Test split)...');
    const candles = generateSyntheticMarket({
      bars: 1400,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 77,
      timeframeMinutes: 15,
    });

    const grid = {
      longThreshold: [68, 72],
      baseAtrStopMult: [1.8, 2.2],
      baseTargetRr: [1.8, 2.2],
    };

    const wf = runWalkForwardAnalysis(candles, DEFAULT_STRATEGY_PARAMETERS, grid, 4, 0.70);

    console.log('\n-------------------- WALK-FORWARD WINDOW BREAKDOWN --------------------');
    for (const w of wf.windows) {
      console.log(
        `Window ${w.windowIndex}: IS Sharpe = ${formatNum(w.trainMetrics.sharpeRatio)}, OOS Sharpe = ${formatNum(
          w.testMetrics.sharpeRatio
        )}, OOS PF = ${formatNum(w.testMetrics.profitFactor)}, OOS Trades = ${w.testMetrics.totalTrades}`
      );
    }
    console.log('-----------------------------------------------------------------------');
    console.log(`Walk-Forward Efficiency (WFE = OOS / IS Sharpe): ${formatNum(wf.walkForwardEfficiency)}`);
    console.log(`Overall Out-Of-Sample Sharpe Ratio:              ${formatNum(wf.overallOosMetrics.sharpeRatio)}`);
    console.log(`Overall Out-Of-Sample Net Profit:                $${formatNum(wf.overallOosMetrics.netProfitCash)}`);
    console.log(`Robustness Verdict:                              ${wf.isRobust ? 'ROBUST & ACCEPTABLE' : 'POTENTIAL OVERFITTING'}\n`);

  } else if (command === 'montecarlo') {
    console.log('[*] Running 1,000-iteration Monte Carlo Bootstrap Resampling...');
    const candles = generateSyntheticMarket({
      bars: 1200,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 88,
      timeframeMinutes: 15,
    });
    const bt = runBacktest(candles, DEFAULT_STRATEGY_PARAMETERS);

    const mc = runMonteCarloSimulation(bt.trades, DEFAULT_STRATEGY_PARAMETERS.initialCapital, 1000, 50);

    console.log('\n------------------ MONTE CARLO SIMULATION RESULTS ------------------');
    console.log(`Simulated Trade Sequences:           ${mc.iterations}`);
    console.log(`Median Max Drawdown (50th %ile):     ${formatPct(mc.medianMaxDrawdownPct)}`);
    console.log(`95th Percentile Max Drawdown:        ${formatPct(mc.p95MaxDrawdownPct)}`);
    console.log(`99th Percentile Max Drawdown (Tail): ${formatPct(mc.p99MaxDrawdownPct)}`);
    console.log(`5th Percentile Final Equity (P5):    $${formatNum(mc.p5FinalEquity)}`);
    console.log(`Median Final Equity (P50):           $${formatNum(mc.medianFinalEquity)}`);
    console.log(`95th Percentile Final Equity (P95):   $${formatNum(mc.p95FinalEquity)}`);
    console.log(`Probability of >=30% Drawdown:       ${formatPct(mc.ruinProbability30Pct)}`);
    console.log(`Probability of >=50% Ruin:           ${formatPct(mc.ruinProbability50Pct)}`);
    console.log(`Median Longest Losing Streak:        ${mc.medianLosingStreak} trades`);
    console.log(`95th Percentile Losing Streak:       ${mc.p95LosingStreak} trades`);
    console.log(`Statistical Risk Profile:            ${mc.isRiskAcceptable ? 'ACCEPTABLE RISK' : 'EXCESSIVE RISK'}\n`);

  } else if (command === 'stability') {
    console.log('[*] Testing Parameter Stability Plateau (sensitivity to perturbations)...');
    const candles = generateSyntheticMarket({
      bars: 1000,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 99,
      timeframeMinutes: 15,
    });

    const report = evaluateParameterStability(candles, DEFAULT_STRATEGY_PARAMETERS);

    console.log('\n------------------ PARAMETER STABILITY REPORT ------------------');
    console.log(`Base Configuration Sharpe:  ${formatNum(report.basePoint.sharpeRatio)}`);
    console.log(`Neighborhood Sharpe Mean:   ${formatNum(report.sharpeMean)}`);
    console.log(`Neighborhood Sharpe StdDev: ${formatNum(report.sharpeStd)}`);
    console.log(`Coefficient of Variation:   ${formatNum(report.sharpeCv)}`);
    console.log(`Neighborhood PF Mean:       ${formatNum(report.profitFactorMean)}`);
    console.log(`Classification:             ${report.stabilityClassification}`);
    console.log(`Is Stable Plateau:          ${report.isStablePlateau ? 'YES (ROBUST)' : 'NO (FRAGILE)'}`);
    if (report.warningMessage) {
      console.log(`\n${report.warningMessage}`);
    }
    console.log('----------------------------------------------------------------\n');

  } else if (command === 'crossmarket') {
    console.log('[*] Running Cross-Market Validation across Crypto, Forex, Equities, and Gold...');
    const presets = getPresetMarketDatasets(1000);

    const datasets = [
      { symbol: 'BTCUSDT', assetClass: 'Crypto' as const, candles: presets.btc },
      { symbol: 'ETHUSDT', assetClass: 'Crypto' as const, candles: presets.eth },
      { symbol: 'EURUSD',  assetClass: 'Forex' as const, candles: presets.eurusd },
      { symbol: 'SPY',     assetClass: 'Equities' as const, candles: presets.spy },
      { symbol: 'XAUUSD',  assetClass: 'Commodities' as const, candles: presets.gold },
    ];

    const report = runCrossMarketValidation(datasets, DEFAULT_STRATEGY_PARAMETERS);

    console.log('\n----------------- CROSS-MARKET PERFORMANCE -----------------');
    for (const r of report.results) {
      console.log(
        `${r.symbol.padEnd(8)} [${r.assetClass.padEnd(11)}]: Trades=${String(r.metrics.totalTrades).padEnd(3)} | Sharpe=${formatNum(
          r.metrics.sharpeRatio
        ).padEnd(5)} | PF=${formatNum(r.metrics.profitFactor).padEnd(5)} | WinRate=${formatPct(
          r.metrics.winRate * 100
        ).padEnd(6)} | MaxDD=${formatPct(r.metrics.maxDrawdownPercent)}`
      );
    }
    console.log('------------------------------------------------------------');
    console.log(`Profitable Markets:               ${report.profitableMarketsCount} / ${report.totalMarkets} (${formatPct(report.percentProfitableMarkets)})`);
    console.log(`Average Cross-Market Sharpe:      ${formatNum(report.averageSharpe)}`);
    console.log(`Average Cross-Market PF:          ${formatNum(report.averageProfitFactor)}`);
    console.log(`Cross-Market Robustness Score:    ${formatNum(report.crossMarketRobustnessScore)} / 100`);
    console.log(`Verdict:                          ${report.isCrossMarketRobust ? 'CROSS-MARKET PORTABLE' : 'ASSET-SPECIFIC'}\n`);

  } else if (command === 'pinets') {
    console.log('[*] Testing companion indicator through LuxAlgo pinets-cli bridge...');
    const candles = generateSyntheticMarket({
      bars: 100,
      startPrice: 65000,
      baseVolDailyPct: 3.5,
      seed: 123,
      timeframeMinutes: 15,
    });

    const result = await PineTsBridge.runScriptWithData({
      scriptPath: 'pine/AdaptiveQuantitativeMarketRegimeIndicator.pine',
      candles,
      candlesCount: 10,
    });

    if (result.success) {
      console.log('[+] PineTS CLI execution succeeded!');
      console.log('Plots detected:', Object.keys(result.plots || {}));
      if (result.plots && result.plots.LongScore) {
        console.log('Sample LongScore data points:', result.plots.LongScore.data.slice(-3));
      }
    } else {
      console.log('[-] PineTS execution error:', result.error);
    }
  } else {
    console.log(`Unknown command: ${command}`);
    console.log('Available commands: backtest, optimize, walkforward, montecarlo, stability, crossmarket, pinets');
  }
}

main().catch(console.error);
