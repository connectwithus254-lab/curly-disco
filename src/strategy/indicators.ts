/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Quantitative Indicators Library
 *
 * Implements mathematically verified, anti-repainting technical and quantitative metrics.
 */

import { Candle } from './types.js';

/**
 * Simple Moving Average (SMA)
 */
export function calculateSma(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) {
      sum -= values[i - length];
    }
    if (i >= length - 1) {
      result[i] = sum / length;
    }
  }
  return result;
}

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEma(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < length || length <= 0) return result;

  const alpha = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += values[i];
  }
  let prevEma = sum / length;
  result[length - 1] = prevEma;

  for (let i = length; i < values.length; i++) {
    prevEma = alpha * values[i] + (1 - alpha) * prevEma;
    result[i] = prevEma;
  }
  return result;
}

/**
 * Wilder's Running Moving Average (RMA)
 */
export function calculateRma(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < length || length <= 0) return result;

  const alpha = 1 / length;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += values[i];
  }
  let prevRma = sum / length;
  result[length - 1] = prevRma;

  for (let i = length; i < values.length; i++) {
    prevRma = alpha * values[i] + (1 - alpha) * prevRma;
    result[i] = prevRma;
  }
  return result;
}

/**
 * Weighted Moving Average (WMA)
 */
export function calculateWma(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += values[i - (length - 1 - j)] * (j + 1);
    }
    result[i] = sum / denom;
  }
  return result;
}

/**
 * Hull Moving Average (HMA)
 * HMA = WMA(2*WMA(n/2) - WMA(n)), sqrt(n))
 */
export function calculateHma(values: number[], length: number): number[] {
  const halfLen = Math.floor(length / 2);
  const sqrtLen = Math.floor(Math.sqrt(length));

  const wmaHalf = calculateWma(values, halfLen);
  const wmaFull = calculateWma(values, length);

  const diff: number[] = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    if (!isNaN(wmaHalf[i]) && !isNaN(wmaFull[i])) {
      diff[i] = 2 * wmaHalf[i] - wmaFull[i];
    } else {
      diff[i] = NaN;
    }
  }

  // WMA of diff over sqrtLen
  const hma = calculateWma(diff, sqrtLen);
  return hma;
}

/**
 * Relative Strength Index (RSI) using Wilder's smoothing
 */
export function calculateRsi(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length <= length) return result;

  const gains: number[] = new Array(values.length).fill(0);
  const losses: number[] = new Array(values.length).fill(0);

  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= length;
  avgLoss /= length;

  if (avgLoss === 0) {
    result[length] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[length] = 100 - 100 / (1 + rs);
  }

  for (let i = length + 1; i < values.length; i++) {
    avgGain = (avgGain * (length - 1) + gains[i]) / length;
    avgLoss = (avgLoss * (length - 1) + losses[i]) / length;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

/**
 * Average True Range (ATR)
 */
export function calculateAtr(candles: Candle[], length: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < length) return result;

  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  }

  return calculateRma(tr, length);
}

/**
 * Rolling Percentile Rank
 * Matches Pine Script's ta.percentrank(source, length)
 * Returns value between 0.0 and 100.0
 */
export function calculatePercentileRank(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(50.0);
  for (let i = length; i < values.length; i++) {
    const current = values[i];
    if (isNaN(current)) continue;

    let countBelow = 0;
    let validCount = 0;
    for (let j = 1; j <= length; j++) {
      const val = values[i - j];
      if (!isNaN(val)) {
        validCount++;
        if (val < current) {
          countBelow++;
        }
      }
    }
    result[i] = validCount > 0 ? (countBelow / validCount) * 100 : 50.0;
  }
  return result;
}

/**
 * Rolling Standard Deviation
 */
export function calculateStdev(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  const sma = calculateSma(values, length);

  for (let i = length - 1; i < values.length; i++) {
    const mean = sma[i];
    let sumSq = 0;
    for (let j = 0; j < length; j++) {
      const diff = values[i - j] - mean;
      sumSq += diff * diff;
    }
    result[i] = Math.sqrt(sumSq / length);
  }
  return result;
}

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
  values: number[],
  length: number,
  mult: number
): { basis: number[]; upper: number[]; lower: number[]; bandwidth: number[] } {
  const basis = calculateSma(values, length);
  const stdev = calculateStdev(values, length);

  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  const bandwidth: number[] = new Array(values.length).fill(NaN);

  for (let i = 0; i < values.length; i++) {
    if (!isNaN(basis[i]) && !isNaN(stdev[i])) {
      const dev = mult * stdev[i];
      upper[i] = basis[i] + dev;
      lower[i] = basis[i] - dev;
      bandwidth[i] = basis[i] !== 0 ? ((upper[i] - lower[i]) / basis[i]) * 100 : 0;
    }
  }

  return { basis, upper, lower, bandwidth };
}

/**
 * Rolling Z-Score
 * z = (close - SMA(close, n)) / Stdev(close, n)
 */
export function calculateZScore(values: number[], length: number): number[] {
  const basis = calculateSma(values, length);
  const stdev = calculateStdev(values, length);
  const result: number[] = new Array(values.length).fill(0);

  for (let i = 0; i < values.length; i++) {
    if (!isNaN(basis[i]) && !isNaN(stdev[i]) && stdev[i] > 0) {
      result[i] = (values[i] - basis[i]) / stdev[i];
    } else {
      result[i] = 0;
    }
  }
  return result;
}

/**
 * Directional Movement System: +DI, -DI, ADX
 */
export function calculateAdx(
  candles: Candle[],
  length: number,
  smoothing: number
): { diPlus: number[]; diMinus: number[]; adx: number[] } {
  const len = candles.length;
  const diPlus: number[] = new Array(len).fill(0);
  const diMinus: number[] = new Array(len).fill(0);
  const adx: number[] = new Array(len).fill(0);

  if (len < length + smoothing) {
    return { diPlus, diMinus, adx };
  }

  const tr: number[] = new Array(len).fill(0);
  const plusDm: number[] = new Array(len).fill(0);
  const minusDm: number[] = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  }

  const trRma = calculateRma(tr, length);
  const plusDmRma = calculateRma(plusDm, length);
  const minusDmRma = calculateRma(minusDm, length);

  const dx: number[] = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    if (!isNaN(trRma[i]) && trRma[i] > 0) {
      const p = (plusDmRma[i] / trRma[i]) * 100;
      const m = (minusDmRma[i] / trRma[i]) * 100;
      diPlus[i] = p;
      diMinus[i] = m;
      const sum = p + m;
      dx[i] = sum > 0 ? (Math.abs(p - m) / sum) * 100 : 0;
    }
  }

  const adxSmoothed = calculateRma(dx, smoothing);
  for (let i = 0; i < len; i++) {
    adx[i] = isNaN(adxSmoothed[i]) ? 0 : adxSmoothed[i];
  }

  return { diPlus, diMinus, adx };
}

/**
 * Kaufman Price Efficiency Ratio (ER)
 * ER = Net Price Change / Sum of individual bar moves
 */
export function calculateEfficiencyRatio(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(0);

  for (let i = length; i < values.length; i++) {
    const netChange = Math.abs(values[i] - values[i - length]);
    let grossPath = 0;
    for (let j = 0; j < length; j++) {
      grossPath += Math.abs(values[i - j] - values[i - j - 1]);
    }
    result[i] = grossPath > 0 ? netChange / grossPath : 0;
  }
  return result;
}

/**
 * Price Curvature (Second-Order Price Change)
 * acceleration = (close[0] - 2*close[1] + close[2]) / ATR
 * Normalized by ATR, smoothed by EMA.
 */
export function calculatePriceCurvature(
  closes: number[],
  atr: number[],
  smoothLength: number
): number[] {
  const rawCurvature: number[] = new Array(closes.length).fill(0);

  for (let i = 2; i < closes.length; i++) {
    const safeAtr = !isNaN(atr[i]) && atr[i] > 0 ? atr[i] : closes[i] * 0.01;
    const accel = closes[i] - 2 * closes[i - 1] + closes[i - 2];
    rawCurvature[i] = accel / safeAtr;
  }

  return calculateEma(rawCurvature, smoothLength);
}

/**
 * Volume-Weighted Average Price (VWAP)
 * Computes rolling/cumulative VWAP
 */
export function calculateVwap(candles: Candle[]): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  let cumVol = 0;
  let cumVolPrice = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumVol += c.volume;
    cumVolPrice += typicalPrice * c.volume;
    result[i] = cumVol > 0 ? cumVolPrice / cumVol : c.close;
  }
  return result;
}

/**
 * Chaikin Money Flow (CMF)
 */
export function calculateCmf(candles: Candle[], length: number): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  const mfVolume: number[] = new Array(candles.length).fill(0);
  const vol: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hl = c.high - c.low;
    const mfMultiplier = hl > 0 ? ((c.close - c.low) - (c.high - c.close)) / hl : 0;
    mfVolume[i] = mfMultiplier * c.volume;
    vol[i] = c.volume;
  }

  const mfSum = calculateSma(mfVolume, length);
  const volSum = calculateSma(vol, length);

  for (let i = 0; i < candles.length; i++) {
    if (!isNaN(mfSum[i]) && !isNaN(volSum[i]) && volSum[i] > 0) {
      result[i] = mfSum[i] / volSum[i];
    } else {
      result[i] = 0;
    }
  }
  return result;
}

/**
 * Non-repainting Pivot High / Pivot Low & Break of Structure (BOS)
 * Evaluates strictly at confirmation bar (rightBars lag)
 */
export function calculatePivotsAndStructure(
  candles: Candle[],
  leftBars: number,
  rightBars: number
): {
  bullishBos: boolean[];
  bearishBos: boolean[];
  higherHighs: boolean[];
  higherLows: boolean[];
  lowerHighs: boolean[];
  lowerLows: boolean[];
} {
  const len = candles.length;
  const bullishBos: boolean[] = new Array(len).fill(false);
  const bearishBos: boolean[] = new Array(len).fill(false);
  const higherHighs: boolean[] = new Array(len).fill(false);
  const higherLows: boolean[] = new Array(len).fill(false);
  const lowerHighs: boolean[] = new Array(len).fill(false);
  const lowerLows: boolean[] = new Array(len).fill(false);

  let lastPivotHigh: number | null = null;
  let prevPivotHigh: number | null = null;
  let lastPivotLow: number | null = null;
  let prevPivotLow: number | null = null;

  for (let i = leftBars + rightBars; i < len; i++) {
    const pivotCandidateBar = i - rightBars;
    const candHigh = candles[pivotCandidateBar].high;
    const candLow = candles[pivotCandidateBar].low;

    // Check if pivot high
    let isPh = true;
    for (let k = pivotCandidateBar - leftBars; k <= pivotCandidateBar + rightBars; k++) {
      if (k !== pivotCandidateBar && candles[k].high > candHigh) {
        isPh = false;
        break;
      }
    }

    if (isPh) {
      prevPivotHigh = lastPivotHigh;
      lastPivotHigh = candHigh;
    }

    // Check if pivot low
    let isPl = true;
    for (let k = pivotCandidateBar - leftBars; k <= pivotCandidateBar + rightBars; k++) {
      if (k !== pivotCandidateBar && candles[k].low < candLow) {
        isPl = false;
        break;
      }
    }

    if (isPl) {
      prevPivotLow = lastPivotLow;
      lastPivotLow = candLow;
    }

    // Current bar BOS checks
    const close = candles[i].close;
    const prevClose = candles[i - 1].close;

    if (lastPivotHigh !== null && prevClose <= lastPivotHigh && close > lastPivotHigh) {
      bullishBos[i] = true;
    }
    if (lastPivotLow !== null && prevClose >= lastPivotLow && close < lastPivotLow) {
      bearishBos[i] = true;
    }

    if (lastPivotHigh !== null && prevPivotHigh !== null) {
      higherHighs[i] = lastPivotHigh > prevPivotHigh;
      lowerHighs[i] = lastPivotHigh < prevPivotHigh;
    }

    if (lastPivotLow !== null && prevPivotLow !== null) {
      higherLows[i] = lastPivotLow > prevPivotLow;
      lowerLows[i] = lastPivotLow < prevPivotLow;
    }
  }

  return {
    bullishBos,
    bearishBos,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
  };
}

/**
 * Resamples raw candles to a higher timeframe and computes HTF indicators.
 * Strictly avoids lookahead by projecting the PREVIOUS closed HTF candle.
 */
export function calculateHtfSeries(
  candles: Candle[],
  baseTfMinutes: number,
  htfMinutes: number,
  fastLen: number,
  slowLen: number
): {
  htfClose: number[];
  htfFastEma: number[];
  htfSlowEma: number[];
  htfBullish: boolean[];
  htfBearish: boolean[];
} {
  const len = candles.length;
  const htfClose: number[] = new Array(len).fill(NaN);
  const htfFastEma: number[] = new Array(len).fill(NaN);
  const htfSlowEma: number[] = new Array(len).fill(NaN);
  const htfBullish: boolean[] = new Array(len).fill(false);
  const htfBearish: boolean[] = new Array(len).fill(false);

  const ratio = Math.max(1, Math.round(htfMinutes / baseTfMinutes));

  // Build aggregated HTF candles
  const htfCandles: { time: number; close: number }[] = [];
  let chunkCount = 0;
  for (let i = 0; i < len; i++) {
    chunkCount++;
    if (chunkCount === ratio || i === len - 1) {
      htfCandles.push({ time: candles[i].time, close: candles[i].close });
      chunkCount = 0;
    }
  }

  const htfCloses = htfCandles.map((c) => c.close);
  const htfFast = calculateEma(htfCloses, fastLen);
  const htfSlow = calculateEma(htfCloses, slowLen);

  // Map HTF values back to base candles with STRICT 1-bar lag (previous closed HTF bar)
  let currentHtfIndex = 0;
  let runningCount = 0;

  for (let i = 0; i < len; i++) {
    runningCount++;
    // We only access the completed previous HTF bar: currentHtfIndex - 1
    const safeIdx = currentHtfIndex - 1;
    if (safeIdx >= 0 && safeIdx < htfCandles.length) {
      htfClose[i] = htfCloses[safeIdx];
      htfFastEma[i] = htfFast[safeIdx];
      htfSlowEma[i] = htfSlow[safeIdx];
      htfBullish[i] =
        !isNaN(htfClose[i]) &&
        !isNaN(htfFastEma[i]) &&
        !isNaN(htfSlowEma[i]) &&
        htfClose[i] > htfFastEma[i] &&
        htfFastEma[i] > htfSlowEma[i];
      htfBearish[i] =
        !isNaN(htfClose[i]) &&
        !isNaN(htfFastEma[i]) &&
        !isNaN(htfSlowEma[i]) &&
        htfClose[i] < htfFastEma[i] &&
        htfFastEma[i] < htfSlowEma[i];
    }

    if (runningCount === ratio) {
      currentHtfIndex++;
      runningCount = 0;
    }
  }

  return { htfClose, htfFastEma, htfSlowEma, htfBullish, htfBearish };
}
