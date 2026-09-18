/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * Core Types and Interfaces
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketRegimeType =
  | 'STRONG_TREND'
  | 'WEAK_TREND'
  | 'RANGE'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION';

export interface StrategyParameters {
  // 1. Risk & Position Sizing
  sizingMode: 'Risk % of Equity' | '% of Equity Capital' | 'Fixed Units';
  riskPerTradePct: number;
  capitalAllocationPct: number;
  fixedUnitsQty: number;
  enableConfidenceSizing: boolean;
  baseAtrStopMult: number;
  baseTargetRr: number;
  adaptiveRrEnabled: boolean;
  enableBreakEven: boolean;
  beTriggerAtr: number;
  beOffsetAtr: number;
  enableTrailingStop: boolean;
  trailActivationAtr: number;
  trailAtrMult: number;
  trailLookback: number;
  maxHoldingBars: number;
  exitOnMomentumCollapse: boolean;
  exitOnOppositeScore: boolean;
  oppExitScoreThreshold: number;

  // 2. Scoring Model & Execution Mode
  longThreshold: number;
  shortThreshold: number;
  executionStyle: 'Hybrid' | 'Extremum Reversals' | 'Trend Pullbacks';
  enableExtremumEngine: boolean;
  extremumZThreshold: number;
  minRejectionWickPct: number;
  enableAntiExhaustion: boolean;
  maxDistFastAtr: number;
  maxDistMedAtr: number;
  maxLongRsi: number;
  minShortRsi: number;
  enableNewsEngine: boolean;
  newsMode: 'Fade Overreaction' | 'Ride Momentum' | 'Halt Trading';
  newsVolThreshold: number;
  newsAtrExpansion: number;
  externalNewsSentiment: number;
  requireHtfNonOpposite: boolean;
  allowBosHtfOverride: boolean;
  minAdxTrendFilter: number;
  minAtrPctFilter: number;
  regimeAdaptiveThresholds: boolean;

  // 3. Multi-Factor Weights
  w_trend: number;
  w_htf: number;
  w_mom: number;
  w_adx: number;
  w_rsiRegime: number;
  w_vwap: number;
  w_volume: number;
  w_volatility: number;
  w_zScore: number;
  w_curvature: number;
  w_structure: number;
  w_er: number;

  // 4. Trend Engine Parameters
  fastEmaLen: number;
  medEmaLen: number;
  slowEmaLen: number;
  useHma: boolean;
  hmaLen: number;

  // 5. HTF Trend Parameters
  htfTimeframeMinutes: number;
  htfFastEmaLen: number;
  htfSlowEmaLen: number;

  // 6. Momentum Engine Parameters
  rsiLen: number;
  rocLen: number;
  normMomLen: number;
  macdFastLen: number;
  macdSlowLen: number;
  macdSignalLen: number;

  // 7. Directional & ADX Engine
  adxLen: number;
  adxSmoothing: number;
  adxTrendLevel: number;

  // 8. Volatility Engine Parameters
  atrLen: number;
  volPercentileLookback: number;
  bbLen: number;
  bbMult: number;

  // 9. Price Distribution & Efficiency
  zScoreLen: number;
  zScoreReversionBand: number;
  erLen: number;

  // 10. Price Curvature & Greeks Proxies
  curvatureSmoothLen: number;
  enableExternalGreeks: boolean;
  extDelta: number;
  extGamma: number;
  extTheta: number;
  extIv: number;

  // 11. Market Structure & Volume
  pivotLeftBars: number;
  pivotRightBars: number;
  volSmaLen: number;
  cmfLen: number;

  // 12. Execution & Cooldown
  entryExecutionType: 'Market' | 'Breakout' | 'Pullback';
  cooldownBars: number;
  maxTradesPerDay: number;
  slippageTicks: number;
  commissionPct: number;
  initialCapital: number;
}

export const DEFAULT_STRATEGY_PARAMETERS: StrategyParameters = {
  sizingMode: '% of Equity Capital',
  riskPerTradePct: 1.0,
  capitalAllocationPct: 10.0,
  fixedUnitsQty: 1.0,
  enableConfidenceSizing: false,
  baseAtrStopMult: 2.0,
  baseTargetRr: 2.0,
  adaptiveRrEnabled: true,
  enableBreakEven: true,
  beTriggerAtr: 2.0,
  beOffsetAtr: 0.15,
  enableTrailingStop: true,
  trailActivationAtr: 2.2,
  trailAtrMult: 2.2,
  trailLookback: 5,
  maxHoldingBars: 120,
  exitOnMomentumCollapse: true,
  exitOnOppositeScore: true,
  oppExitScoreThreshold: 80.0,

  longThreshold: 65.0,
  shortThreshold: 65.0,
  executionStyle: 'Hybrid',
  enableExtremumEngine: true,
  extremumZThreshold: 1.5,
  minRejectionWickPct: 25.0,
  enableAntiExhaustion: true,
  maxDistFastAtr: 1.3,
  maxDistMedAtr: 2.2,
  maxLongRsi: 70.0,
  minShortRsi: 30.0,
  enableNewsEngine: true,
  newsMode: 'Fade Overreaction',
  newsVolThreshold: 2.2,
  newsAtrExpansion: 1.8,
  externalNewsSentiment: 0.0,
  requireHtfNonOpposite: true,
  allowBosHtfOverride: true,
  minAdxTrendFilter: 16.0,
  minAtrPctFilter: 0.02,
  regimeAdaptiveThresholds: true,

  w_trend: 16.0,
  w_htf: 14.0,
  w_mom: 14.0,
  w_adx: 10.0,
  w_rsiRegime: 6.0,
  w_vwap: 6.0,
  w_volume: 6.0,
  w_volatility: 6.0,
  w_zScore: 6.0,
  w_curvature: 6.0,
  w_structure: 10.0,
  w_er: 6.0,

  fastEmaLen: 9,
  medEmaLen: 50,
  slowEmaLen: 200,
  useHma: true,
  hmaLen: 21,

  htfTimeframeMinutes: 60,
  htfFastEmaLen: 20,
  htfSlowEmaLen: 50,

  rsiLen: 14,
  rocLen: 10,
  normMomLen: 10,
  macdFastLen: 12,
  macdSlowLen: 26,
  macdSignalLen: 9,

  adxLen: 14,
  adxSmoothing: 14,
  adxTrendLevel: 25.0,

  atrLen: 14,
  volPercentileLookback: 100,
  bbLen: 20,
  bbMult: 2.0,

  zScoreLen: 20,
  zScoreReversionBand: 2.0,
  erLen: 10,

  curvatureSmoothLen: 3,
  enableExternalGreeks: false,
  extDelta: 0.0,
  extGamma: 0.0,
  extTheta: 0.0,
  extIv: 0.0,

  pivotLeftBars: 5,
  pivotRightBars: 5,
  volSmaLen: 20,
  cmfLen: 20,

  entryExecutionType: 'Market',
  cooldownBars: 5,
  maxTradesPerDay: 4,
  slippageTicks: 2,
  commissionPct: 0.05,
  initialCapital: 100000,
};

export interface IndicatorSeries {
  safeAtr: number[];
  atrPct: number[];
  atrPercentile: number[];
  bbWidth: number[];
  bbwPercentile: number[];
  isVolSqueeze: boolean[];
  isVolExpansion: boolean[];

  emaFast: number[];
  emaMed: number[];
  emaSlow: number[];
  hmaVal: number[];
  bullishTrendAlign: boolean[];
  bearishTrendAlign: boolean[];
  trendDistAtr: number[];

  htfClose: number[];
  htfFastEma: number[];
  htfSlowEma: number[];
  htfBullish: boolean[];
  htfBearish: boolean[];

  rsiVal: number[];
  rocVal: number[];
  normMom: number[];
  normMacdHist: number[];
  distEmaMedAtr: number[];

  diPlus: number[];
  diMinus: number[];
  adxVal: number[];
  diSpreadNorm: number[];

  safeVwap: number[];
  distVwapAtr: number[];
  vwapSlopeUp: boolean[];

  rVol: number[];
  cmfVal: number[];

  zScore: number[];
  priceCurvature: number[];
  efficiencyRatio: number[];

  bullishBos: boolean[];
  bearishBos: boolean[];
  higherHighs: boolean[];
  higherLows: boolean[];
  lowerHighs: boolean[];
  lowerLows: boolean[];

  regime: MarketRegimeType[];
  compositeLongScore: number[];
  compositeShortScore: number[];
  effectiveLongThreshold: number[];
  effectiveShortThreshold: number[];
  effectiveStopMult: number[];
  effectiveRr: number[];
}

export type OrderDirection = 'LONG' | 'SHORT';

export interface TradeSignal {
  time: number;
  barIndex: number;
  direction: OrderDirection;
  price: number;
  stopDistance: number;
  stopLoss: number;
  takeProfit: number;
  score: number;
  regime: MarketRegimeType;
  adx: number;
  atr: number;
}

export type ExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'MOMENTUM_COLLAPSE'
  | 'OPPOSITE_SCORE'
  | 'MAX_HOLDING_BARS'
  | 'END_OF_DATA';

export interface TradeRecord {
  id: number;
  direction: OrderDirection;
  entryTime: number;
  entryBar: number;
  entryPrice: number;
  exitTime: number;
  exitBar: number;
  exitPrice: number;
  qty: number;
  initialStop: number;
  initialTarget: number;
  realizedPnlCash: number;
  realizedPnlPct: number;
  exitReason: ExitReason;
  holdingBars: number;
  rMultiple: number;
  entryRegime: MarketRegimeType;
  entryScore: number;
  entryReason?: string;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;              // 0.0 - 1.0
  profitFactor: number;         // grossProfit / grossLoss
  expectancy: number;           // avg $ per trade
  expectancyRatio: number;      // Expectancy / initial risk
  maxDrawdownCash: number;      // Peak to trough cash loss
  maxDrawdownPercent: number;   // Peak to trough percentage loss
  sharpeRatio: number;          // Annualized Sharpe Ratio
  sortinoRatio: number;         // Annualized Sortino Ratio
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;         // avgWin / avgLoss
  marketExposurePercent: number;// % time invested
  longestLosingStreak: number;
  longestWinningStreak: number;
  cagr: number;                 // Compound annual growth rate
  calmarRatio: number;          // CAGR / Max Drawdown %
  netProfitCash: number;
  netProfitPercent: number;
  finalEquity: number;
}
