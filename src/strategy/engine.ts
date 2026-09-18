/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Strategy Simulation Engine
 *
 * Implements full bar-by-bar state machine matching Pine Script order execution.
 */

import {
  Candle,
  StrategyParameters,
  TradeSignal,
  TradeRecord,
  OrderDirection,
  ExitReason,
  MarketRegimeType,
} from './types.js';
import {
  calculateAtr,
  calculatePercentileRank,
  calculateBollingerBands,
  calculateEma,
  calculateHma,
  calculateHtfSeries,
  calculateRsi,
  calculateAdx,
  calculateVwap,
  calculateSma,
  calculateCmf,
  calculateZScore,
  calculatePriceCurvature,
  calculateEfficiencyRatio,
  calculatePivotsAndStructure,
} from './indicators.js';
import { evaluateMarketRegime } from './regime.js';
import { calculateBarFactorScores, BarIndicatorContext } from './scoring.js';

export interface BacktestState {
  trades: TradeRecord[];
  signals: TradeSignal[];
  equityCurve: { time: number; equity: number }[];
  finalEquity: number;
}

export function runStrategyEngine(
  candles: Candle[],
  params: StrategyParameters
): BacktestState {
  const len = candles.length;
  if (len < 100) {
    return {
      trades: [],
      signals: [],
      equityCurve: candles.map((c) => ({ time: c.time, equity: params.initialCapital })),
      finalEquity: params.initialCapital,
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  // 1. Precalculate Technical Indicators
  const atr = calculateAtr(candles, params.atrLen);
  const safeAtr = atr.map((v, i) => (isNaN(v) || v <= 0 ? closes[i] * 0.01 : v));
  const atrPercentile = calculatePercentileRank(safeAtr, params.volPercentileLookback);

  const bb = calculateBollingerBands(closes, params.bbLen, params.bbMult);
  const bbwPercentile = calculatePercentileRank(bb.bandwidth, params.volPercentileLookback);

  const emaFast = calculateEma(closes, params.fastEmaLen);
  const emaMed = calculateEma(closes, params.medEmaLen);
  const emaSlow = calculateEma(closes, params.slowEmaLen);
  const hma = params.useHma
    ? calculateHma(closes, params.hmaLen)
    : emaFast;

  const htf = calculateHtfSeries(
    candles,
    15, // Assume standard 15m base if not provided
    params.htfTimeframeMinutes,
    params.htfFastEmaLen,
    params.htfSlowEmaLen
  );

  const rsi = calculateRsi(closes, params.rsiLen);
  const adx = calculateAdx(candles, params.adxLen, params.adxSmoothing);
  const vwap = calculateVwap(candles);
  const volSma = calculateSma(volumes, params.volSmaLen);
  const cmf = calculateCmf(candles, params.cmfLen);
  const zScore = calculateZScore(closes, params.zScoreLen);
  const curvature = calculatePriceCurvature(closes, safeAtr, params.curvatureSmoothLen);
  const er = calculateEfficiencyRatio(closes, params.erLen);
  const structure = calculatePivotsAndStructure(
    candles,
    params.pivotLeftBars,
    params.pivotRightBars
  );

  // MACD & Normalized Momentum
  const macdFast = calculateEma(closes, params.macdFastLen);
  const macdSlow = calculateEma(closes, params.macdSlowLen);
  const macdLine = closes.map((_, i) => macdFast[i] - macdSlow[i]);
  const macdSignal = calculateEma(macdLine, params.macdSignalLen);
  const macdHistNorm = closes.map((_, i) => (macdLine[i] - macdSignal[i]) / safeAtr[i]);

  const normMom = closes.map((c, i) => {
    const pastIdx = Math.max(0, i - params.normMomLen);
    return (c - closes[pastIdx]) / safeAtr[i];
  });

  // State Machine Variables
  let equity = params.initialCapital;
  const equityCurve: { time: number; equity: number }[] = [];
  const trades: TradeRecord[] = [];
  const signals: TradeSignal[] = [];

  interface ActivePosition {
    id: number;
    direction: OrderDirection;
    entryTime: number;
    entryBar: number;
    entryPrice: number;
    qty: number;
    stopLoss: number;
    takeProfit: number;
    initialStop: number;
    initialTarget: number;
    effectiveStopDist: number;
    effectiveRr: number;
    regime: MarketRegimeType;
    score: number;
    isBeActive: boolean;
    isTrailActive: boolean;
  }

  let position: ActivePosition | null = null;
  let lastExitBar = -100;
  let tradesToday = 0;
  let lastTradeDay = -1;
  let tradeCounter = 0;

  const warmupBars = Math.max(
    params.slowEmaLen,
    params.volPercentileLookback,
    params.zScoreLen,
    50
  );

  for (let i = warmupBars; i < len; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];

    // Day change reset
    const date = new Date(c.time);
    const day = date.getUTCDate();
    if (day !== lastTradeDay) {
      tradesToday = 0;
      lastTradeDay = day;
    }

    // Context Evaluation for Current Bar
    const trendDistAtr = (emaFast[i] - emaSlow[i]) / safeAtr[i];
    const isVolSqueeze = bbwPercentile[i] <= 20.0 && atrPercentile[i] <= 25.0;
    const bullishTrendAlign =
      c.close > emaFast[i] && emaFast[i] > emaMed[i] && emaMed[i] > emaSlow[i];
    const bearishTrendAlign =
      c.close < emaFast[i] && emaFast[i] < emaMed[i] && emaMed[i] < emaSlow[i];

    const regimeEval = evaluateMarketRegime(
      adx.adx[i],
      er[i],
      trendDistAtr,
      atrPercentile[i],
      bbwPercentile[i],
      isVolSqueeze,
      bullishTrendAlign,
      bearishTrendAlign,
      params
    );

    const rVol = volSma[i] > 0 ? c.volume / volSma[i] : 1.0;
    const diSum = adx.diPlus[i] + adx.diMinus[i];
    const diSpreadNorm = diSum > 0 ? (adx.diPlus[i] - adx.diMinus[i]) / diSum : 0;

    const ctx: BarIndicatorContext = {
      close: c.close,
      prevClose: prevC.close,
      high: c.high,
      low: c.low,
      volume: c.volume,

      safeAtr: safeAtr[i],
      atrPercentile: atrPercentile[i],
      isVolSqueeze,

      emaFast: emaFast[i],
      emaMed: emaMed[i],
      emaSlow: emaSlow[i],
      hmaVal: hma[i],
      prevEmaFast: emaFast[i - 1],
      prevEmaMed: emaMed[i - 1],
      prevEmaSlow: emaSlow[i - 1],
      prevHmaVal: hma[i - 1],

      htfClose: htf.htfClose[i],
      htfFastEma: htf.htfFastEma[i],
      htfSlowEma: htf.htfSlowEma[i],
      prevHtfFastEma: htf.htfFastEma[i - 1],

      rsiVal: rsi[i],
      normMom: normMom[i],
      normMacdHist: macdHistNorm[i],
      prevNormMacdHist: macdHistNorm[i - 1],
      distEmaMedAtr: (c.close - emaMed[i]) / safeAtr[i],

      diPlus: adx.diPlus[i],
      diMinus: adx.diMinus[i],
      adxVal: adx.adx[i],
      diSpreadNorm,

      safeVwap: vwap[i],
      prevVwap: vwap[i - 1],
      distVwapAtr: (c.close - vwap[i]) / safeAtr[i],

      rVol,
      cmfVal: cmf[i],

      zScore: zScore[i],
      priceCurvature: curvature[i],
      prevPriceCurvature: curvature[i - 1],
      efficiencyRatio: er[i],

      bullishBos: structure.bullishBos[i],
      bearishBos: structure.bearishBos[i],
      higherHighs: structure.higherHighs[i],
      higherLows: structure.higherLows[i],
      lowerHighs: structure.lowerHighs[i],
      lowerLows: structure.lowerLows[i],
    };

    const factorScores = calculateBarFactorScores(ctx, params);

    // Filters
    const minAtrSatisfied = (safeAtr[i] / c.close) * 100 >= params.minAtrPctFilter;
    const adxFilterSatisfied =
      regimeEval.regime === 'RANGE' || regimeEval.regime === 'LOW_VOLATILITY'
        ? true
        : adx.adx[i] >= params.minAdxTrendFilter;
    const cooldownPassed =
      i - lastExitBar >= params.cooldownBars &&
      (position !== null || tradesToday < params.maxTradesPerDay);

    const htfLongContradiction = params.requireHtfNonOpposite && htf.htfBearish[i];
    const htfShortContradiction = params.requireHtfNonOpposite && htf.htfBullish[i];

    // Signal Triggers
    const validLongSignal =
      cooldownPassed &&
      minAtrSatisfied &&
      adxFilterSatisfied &&
      !htfLongContradiction &&
      factorScores.compositeLongScore >= regimeEval.effectiveLongThreshold &&
      factorScores.compositeLongScore > factorScores.compositeShortScore + 10.0;

    const validShortSignal =
      cooldownPassed &&
      minAtrSatisfied &&
      adxFilterSatisfied &&
      !htfShortContradiction &&
      factorScores.compositeShortScore >= regimeEval.effectiveShortThreshold &&
      factorScores.compositeShortScore > factorScores.compositeLongScore + 10.0;

    // Manage Active Position
    if (position !== null) {
      let exitPrice = 0;
      let exitReason: ExitReason | null = null;

      if (position.direction === 'LONG') {
        // 1. Break-even check
        if (params.enableBreakEven && !position.isBeActive) {
          if (c.high >= position.entryPrice + position.effectiveStopDist * (params.beTriggerAtr / params.baseAtrStopMult)) {
            position.stopLoss = Math.max(
              position.stopLoss,
              position.entryPrice + safeAtr[i] * params.beOffsetAtr
            );
            position.isBeActive = true;
          }
        }

        // 2. Trailing stop check
        if (params.enableTrailingStop) {
          if (c.high >= position.entryPrice + safeAtr[i] * params.trailActivationAtr) {
            position.isTrailActive = true;
          }
          if (position.isTrailActive) {
            let highestLookback = c.high;
            for (let k = 1; k < params.trailLookback; k++) {
              if (i - k >= 0) highestLookback = Math.max(highestLookback, candles[i - k].high);
            }
            const candidateStop = highestLookback - safeAtr[i] * params.trailAtrMult;
            position.stopLoss = Math.max(position.stopLoss, candidateStop);
          }
        }

        // 3. Intra-bar Stop Loss and Take Profit
        if (c.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = position.isTrailActive ? 'TRAILING_STOP' : 'STOP_LOSS';
        } else if (c.high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'TAKE_PROFIT';
        } else if (
          params.exitOnMomentumCollapse &&
          (c.close < emaMed[i] || rsi[i] < 35.0)
        ) {
          exitPrice = c.close;
          exitReason = 'MOMENTUM_COLLAPSE';
        } else if (
          params.exitOnOppositeScore &&
          factorScores.compositeShortScore >= params.oppExitScoreThreshold
        ) {
          exitPrice = c.close;
          exitReason = 'OPPOSITE_SCORE';
        } else if (
          params.maxHoldingBars > 0 &&
          i - position.entryBar >= params.maxHoldingBars
        ) {
          exitPrice = c.close;
          exitReason = 'MAX_HOLDING_BARS';
        }
      } else {
        // SHORT Position Management
        if (params.enableBreakEven && !position.isBeActive) {
          if (c.low <= position.entryPrice - position.effectiveStopDist * (params.beTriggerAtr / params.baseAtrStopMult)) {
            position.stopLoss = Math.min(
              position.stopLoss,
              position.entryPrice - safeAtr[i] * params.beOffsetAtr
            );
            position.isBeActive = true;
          }
        }

        if (params.enableTrailingStop) {
          if (c.low <= position.entryPrice - safeAtr[i] * params.trailActivationAtr) {
            position.isTrailActive = true;
          }
          if (position.isTrailActive) {
            let lowestLookback = c.low;
            for (let k = 1; k < params.trailLookback; k++) {
              if (i - k >= 0) lowestLookback = Math.min(lowestLookback, candles[i - k].low);
            }
            const candidateStop = lowestLookback + safeAtr[i] * params.trailAtrMult;
            position.stopLoss = Math.min(position.stopLoss, candidateStop);
          }
        }

        if (c.high >= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = position.isTrailActive ? 'TRAILING_STOP' : 'STOP_LOSS';
        } else if (c.low <= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'TAKE_PROFIT';
        } else if (
          params.exitOnMomentumCollapse &&
          (c.close > emaMed[i] || rsi[i] > 65.0)
        ) {
          exitPrice = c.close;
          exitReason = 'MOMENTUM_COLLAPSE';
        } else if (
          params.exitOnOppositeScore &&
          factorScores.compositeLongScore >= params.oppExitScoreThreshold
        ) {
          exitPrice = c.close;
          exitReason = 'OPPOSITE_SCORE';
        } else if (
          params.maxHoldingBars > 0 &&
          i - position.entryBar >= params.maxHoldingBars
        ) {
          exitPrice = c.close;
          exitReason = 'MAX_HOLDING_BARS';
        }
      }

      // Close Position if triggered
      if (exitReason !== null) {
        // Slippage & Commission modeling
        const slippagePenalty = (exitPrice * (params.slippageTicks * 0.0001));
        const finalExitPrice =
          position.direction === 'LONG'
            ? exitPrice - slippagePenalty
            : exitPrice + slippagePenalty;

        const rawPnl =
          position.direction === 'LONG'
            ? (finalExitPrice - position.entryPrice) * position.qty
            : (position.entryPrice - finalExitPrice) * position.qty;

        const entryCommission = position.entryPrice * position.qty * (params.commissionPct / 100);
        const exitCommission = finalExitPrice * position.qty * (params.commissionPct / 100);
        const netPnlCash = rawPnl - (entryCommission + exitCommission);
        const netPnlPct = (netPnlCash / (position.entryPrice * position.qty)) * 100;

        equity += netPnlCash;
        const initialRisk = Math.abs(position.entryPrice - position.initialStop) * position.qty;
        const rMultiple = initialRisk > 0 ? netPnlCash / initialRisk : 0;

        trades.push({
          id: position.id,
          direction: position.direction,
          entryTime: position.entryTime,
          entryBar: position.entryBar,
          entryPrice: position.entryPrice,
          exitTime: c.time,
          exitBar: i,
          exitPrice: finalExitPrice,
          qty: position.qty,
          initialStop: position.initialStop,
          initialTarget: position.initialTarget,
          realizedPnlCash: netPnlCash,
          realizedPnlPct: netPnlPct,
          exitReason,
          holdingBars: i - position.entryBar,
          rMultiple,
          entryRegime: position.regime,
          entryScore: position.score,
        });

        lastExitBar = i;
        position = null;
      }
    }

    // New Entry Evaluation (if flat)
    if (position === null) {
      if (validLongSignal) {
        const stopDist = safeAtr[i] * regimeEval.effectiveStopMult;
        let qty = 0;
        if (params.sizingMode === 'Risk % of Equity') {
          const cashRisk = equity * (params.riskPerTradePct / 100);
          qty = stopDist > 0 ? cashRisk / stopDist : 0;
        } else if (params.sizingMode === '% of Equity Capital') {
          const capital = equity * (params.capitalAllocationPct / 100);
          qty = c.close > 0 ? capital / c.close : 0;
        } else {
          qty = params.fixedUnitsQty;
        }

        if (params.enableConfidenceSizing && factorScores.compositeLongScore > regimeEval.effectiveLongThreshold) {
          const boost = Math.min(
            0.3,
            ((factorScores.compositeLongScore - regimeEval.effectiveLongThreshold) /
              (100 - regimeEval.effectiveLongThreshold)) *
              0.3
          );
          qty *= 1.0 + boost;
        }

        if (qty > 0) {
          tradeCounter++;
          const entryPrice = c.close;
          const stopLoss = entryPrice - stopDist;
          const takeProfit = entryPrice + stopDist * regimeEval.effectiveRr;

          position = {
            id: tradeCounter,
            direction: 'LONG',
            entryTime: c.time,
            entryBar: i,
            entryPrice,
            qty,
            stopLoss,
            takeProfit,
            initialStop: stopLoss,
            initialTarget: takeProfit,
            effectiveStopDist: stopDist,
            effectiveRr: regimeEval.effectiveRr,
            regime: regimeEval.regime,
            score: factorScores.compositeLongScore,
            isBeActive: false,
            isTrailActive: false,
          };

          signals.push({
            time: c.time,
            barIndex: i,
            direction: 'LONG',
            price: entryPrice,
            stopDistance: stopDist,
            stopLoss,
            takeProfit,
            score: factorScores.compositeLongScore,
            regime: regimeEval.regime,
            adx: adx.adx[i],
            atr: safeAtr[i],
          });

          tradesToday++;
        }
      } else if (validShortSignal) {
        const stopDist = safeAtr[i] * regimeEval.effectiveStopMult;
        let qty = 0;
        if (params.sizingMode === 'Risk % of Equity') {
          const cashRisk = equity * (params.riskPerTradePct / 100);
          qty = stopDist > 0 ? cashRisk / stopDist : 0;
        } else if (params.sizingMode === '% of Equity Capital') {
          const capital = equity * (params.capitalAllocationPct / 100);
          qty = c.close > 0 ? capital / c.close : 0;
        } else {
          qty = params.fixedUnitsQty;
        }

        if (params.enableConfidenceSizing && factorScores.compositeShortScore > regimeEval.effectiveShortThreshold) {
          const boost = Math.min(
            0.3,
            ((factorScores.compositeShortScore - regimeEval.effectiveShortThreshold) /
              (100 - regimeEval.effectiveShortThreshold)) *
              0.3
          );
          qty *= 1.0 + boost;
        }

        if (qty > 0) {
          tradeCounter++;
          const entryPrice = c.close;
          const stopLoss = entryPrice + stopDist;
          const takeProfit = entryPrice - stopDist * regimeEval.effectiveRr;

          position = {
            id: tradeCounter,
            direction: 'SHORT',
            entryTime: c.time,
            entryBar: i,
            entryPrice,
            qty,
            stopLoss,
            takeProfit,
            initialStop: stopLoss,
            initialTarget: takeProfit,
            effectiveStopDist: stopDist,
            effectiveRr: regimeEval.effectiveRr,
            regime: regimeEval.regime,
            score: factorScores.compositeShortScore,
            isBeActive: false,
            isTrailActive: false,
          };

          signals.push({
            time: c.time,
            barIndex: i,
            direction: 'SHORT',
            price: entryPrice,
            stopDistance: stopDist,
            stopLoss,
            takeProfit,
            score: factorScores.compositeShortScore,
            regime: regimeEval.regime,
            adx: adx.adx[i],
            atr: safeAtr[i],
          });

          tradesToday++;
        }
      }
    }

    // Equity tracking with unrealized PnL
    let markToMarketEquity = equity;
    if (position !== null) {
      const unrealizedPnl =
        position.direction === 'LONG'
          ? (c.close - position.entryPrice) * position.qty
          : (position.entryPrice - c.close) * position.qty;
      markToMarketEquity += unrealizedPnl;
    }
    equityCurve.push({ time: c.time, equity: markToMarketEquity });
  }

  // Close open position at end of data
  if (position !== null) {
    const lastBar = candles[len - 1];
    const rawPnl =
      position.direction === 'LONG'
        ? (lastBar.close - position.entryPrice) * position.qty
        : (position.entryPrice - lastBar.close) * position.qty;
    const entryCommission = position.entryPrice * position.qty * (params.commissionPct / 100);
    const exitCommission = lastBar.close * position.qty * (params.commissionPct / 100);
    const netPnlCash = rawPnl - (entryCommission + exitCommission);
    const netPnlPct = (netPnlCash / (position.entryPrice * position.qty)) * 100;
    equity += netPnlCash;

    trades.push({
      id: position.id,
      direction: position.direction,
      entryTime: position.entryTime,
      entryBar: position.entryBar,
      entryPrice: position.entryPrice,
      exitTime: lastBar.time,
      exitBar: len - 1,
      exitPrice: lastBar.close,
      qty: position.qty,
      initialStop: position.initialStop,
      initialTarget: position.initialTarget,
      realizedPnlCash: netPnlCash,
      realizedPnlPct: netPnlPct,
      exitReason: 'END_OF_DATA',
      holdingBars: len - 1 - position.entryBar,
      rMultiple: netPnlCash / (Math.abs(position.entryPrice - position.initialStop) * position.qty),
      entryRegime: position.regime,
      entryScore: position.score,
    });
  }

  return {
    trades,
    signals,
    equityCurve,
    finalEquity: equity,
  };
}
