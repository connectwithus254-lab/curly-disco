/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Quantitative Performance & Statistical Metrics Calculator
 */

import { PerformanceMetrics, TradeRecord } from '../strategy/types.js';

export function calculatePerformanceMetrics(
  trades: TradeRecord[],
  equityCurve: { time: number; equity: number }[],
  initialCapital: number,
  totalBars: number
): PerformanceMetrics {
  const totalTrades = trades.length;

  if (totalTrades === 0 || equityCurve.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      expectancyRatio: 0,
      maxDrawdownCash: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      avgWin: 0,
      avgLoss: 0,
      winLossRatio: 0,
      marketExposurePercent: 0,
      longestLosingStreak: 0,
      longestWinningStreak: 0,
      cagr: 0,
      calmarRatio: 0,
      netProfitCash: 0,
      netProfitPercent: 0,
      finalEquity: initialCapital,
    };
  }

  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalWinPnL = 0;
  let totalLossPnL = 0;
  let investedBars = 0;

  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;

  for (const t of trades) {
    investedBars += t.holdingBars;

    if (t.realizedPnlCash > 0) {
      winningTrades++;
      grossProfit += t.realizedPnlCash;
      totalWinPnL += t.realizedPnlCash;
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinningStreak) longestWinningStreak = currentWinStreak;
    } else if (t.realizedPnlCash < 0) {
      losingTrades++;
      grossLoss += Math.abs(t.realizedPnlCash);
      totalLossPnL += Math.abs(t.realizedPnlCash);
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > longestLosingStreak) longestLosingStreak = currentLossStreak;
    } else {
      breakEvenTrades++;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }

  const winRate = winningTrades / totalTrades;
  const avgWin = winningTrades > 0 ? totalWinPnL / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? totalLossPnL / losingTrades : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const expectancyRatio = avgLoss > 0 ? expectancy / avgLoss : 0;

  // Maximum Drawdown Analysis
  let peak = equityCurve[0].equity;
  let maxDrawdownCash = 0;
  let maxDrawdownPercent = 0;

  for (const pt of equityCurve) {
    if (pt.equity > peak) {
      peak = pt.equity;
    }
    const ddCash = peak - pt.equity;
    const ddPct = peak > 0 ? (ddCash / peak) * 100 : 0;

    if (ddCash > maxDrawdownCash) maxDrawdownCash = ddCash;
    if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;
  }

  // Bar returns for Sharpe and Sortino (Annualized assuming standard 252 trading days)
  const barReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const curr = equityCurve[i].equity;
    if (prev > 0) {
      barReturns.push((curr - prev) / prev);
    }
  }

  let meanReturn = 0;
  for (const r of barReturns) meanReturn += r;
  meanReturn = barReturns.length > 0 ? meanReturn / barReturns.length : 0;

  let variance = 0;
  let downsideVariance = 0;
  for (const r of barReturns) {
    const diff = r - meanReturn;
    variance += diff * diff;
    if (r < 0) {
      downsideVariance += r * r;
    }
  }
  const stdev = barReturns.length > 1 ? Math.sqrt(variance / (barReturns.length - 1)) : 0;
  const downsideStdev = barReturns.length > 1 ? Math.sqrt(downsideVariance / (barReturns.length - 1)) : 0;

  // Annualization factor (assume ~252 * 24 periods for hourly, or ~252 for daily)
  const periodsPerYear = 252 * 6.5 * 4; // ~6500 bars for 15-min bars
  const annualFactor = Math.sqrt(periodsPerYear);

  const sharpeRatio = stdev > 0 ? (meanReturn / stdev) * annualFactor : 0;
  const sortinoRatio = downsideStdev > 0 ? (meanReturn / downsideStdev) * annualFactor : 0;

  // Market Exposure %
  const marketExposurePercent = totalBars > 0 ? Math.min(100, (investedBars / totalBars) * 100) : 0;

  // Final Net Profit & CAGR
  const finalEquity = equityCurve[equityCurve.length - 1].equity;
  const netProfitCash = finalEquity - initialCapital;
  const netProfitPercent = (netProfitCash / initialCapital) * 100;

  const startTime = equityCurve[0].time;
  const endTime = equityCurve[equityCurve.length - 1].time;
  const years = Math.max(0.01, (endTime - startTime) / (1000 * 3600 * 24 * 365.25));
  const cagr = ((Math.max(0.001, finalEquity) / initialCapital) ** (1 / years) - 1) * 100;
  const calmarRatio = maxDrawdownPercent > 0 ? cagr / maxDrawdownPercent : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRate,
    profitFactor,
    expectancy,
    expectancyRatio,
    maxDrawdownCash,
    maxDrawdownPercent,
    sharpeRatio,
    sortinoRatio,
    avgWin,
    avgLoss,
    winLossRatio,
    marketExposurePercent,
    longestLosingStreak,
    longestWinningStreak,
    cagr,
    calmarRatio,
    netProfitCash,
    netProfitPercent,
    finalEquity,
  };
}
