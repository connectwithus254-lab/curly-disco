# Inputs & Parameters Reference Guide

This document details every user-configurable parameter in the **Adaptive Quantitative Market Regime Strategy (AQMRS)**, explaining its function, default setting, and quantitative rationale.

---

## 1. Strategy Risk & Position Sizing
| Parameter | Type | Default | Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `sizingMode` | String | `"Risk % of Equity"` | Options | Determines position sizing mode: `Risk % of Equity`, `% of Equity Capital`, or `Fixed Units`. |
| `riskPerTradePct` | Float | `1.0%` | `0.05 - 10.0%` | Equity percentage risked on the initial stop-loss distance. |
| `capitalAllocationPct` | Float | `10.0%` | `1.0 - 100.0%` | Fixed capital percentage allocated per trade (when `% of Equity Capital` mode selected). |
| `fixedUnitsQty` | Float | `1.0` | `> 0` | Fixed contract or share size (when `Fixed Units` mode selected). |
| `enableConfidenceSizing` | Bool | `false` | `true/false` | Disciplinary switch: scales position size slightly (up to +30%) on higher signal scores. |
| `baseAtrStopMult` | Float | `2.0` | `0.5 - 10.0` | Multiplier for ATR distance to initial Stop Loss. |
| `baseTargetRr` | Float | `2.0` | `0.5 - 10.0` | Risk-to-Reward ratio for Take Profit target. |
| `adaptiveRrEnabled` | Bool | `true` | `true/false` | Expands target R:R in strong trends (e.g. 2.7x) and tightens in ranges (e.g. 1.5x). |
| `enableBreakEven` | Bool | `true` | `true/false` | Automatically moves Stop Loss to entry price after favorable excursion. |
| `beTriggerAtr` | Float | `1.5` | `0.5 - 5.0` | ATR profit threshold required to trigger Break-Even stop. |
| `beOffsetAtr` | Float | `0.1` | `0.0 - 1.0` | Buffer beyond entry price to lock in fees/slippage upon Break-Even trigger. |
| `enableTrailingStop` | Bool | `true` | `true/false` | Activates monotonic ATR chandelier trailing stop. |
| `trailActivationAtr` | Float | `1.5` | `0.5 - 5.0` | Minimum ATR profit required before trailing stop begins ratcheting. |
| `trailAtrMult` | Float | `2.0` | `0.5 - 5.0` | Trailing stop ATR offset from recent price extrema. |
| `trailLookback` | Int | `7` | `2 - 50` | Bar lookback for highest high / lowest low trailing reference. |
| `maxHoldingBars` | Int | `120` | `0 - 1000` | Maximum holding duration in bars (0 = disabled). Exits stagnant trades. |
| `exitOnMomentumCollapse`| Bool | `true` | `true/false` | Exits trade early if RSI crosses adverse levels or price breaches 50 EMA. |
| `exitOnOppositeScore` | Bool | `true` | `true/false` | Exits trade if opposite composite score becomes extreme. |
| `oppExitScoreThreshold` | Float | `78.0` | `50 - 100` | Score threshold on opposite side triggering emergency exit. |

---

## 2. Scoring Model Thresholds & Filters
| Parameter | Type | Default | Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `longThreshold` | Float | `70.0` | `40 - 95` | Minimum composite score required to enter a Long position. |
| `shortThreshold` | Float | `70.0` | `40 - 95` | Minimum composite score required to enter a Short position. |
| `requireHtfNonOpposite`| Bool | `true` | `true/false` | Blocks Longs if HTF trend is bearish; blocks Shorts if HTF trend is bullish. |
| `minAdxTrendFilter` | Float | `18.0` | `0 - 50` | Minimum ADX required for trend entries (bypassed in ranges). |
| `minAtrPctFilter` | Float | `0.02%` | `0.0 - 5.0%` | Liquidity filter: prevents trading on flat/frozen markets. |
| `regimeAdaptiveThresholds`| Bool | `true` | `true/false` | Dynamically raises or lowers entry threshold based on regime risk. |

---

## 3. Multi-Factor Scoring Weights
| Parameter | Default | Function |
| :--- | :--- | :--- |
| `w_trend` | `15.0` | Weight assigned to EMA alignment and slope metrics. |
| `w_htf` | `15.0` | Weight assigned to Higher-Timeframe trend confirmation. |
| `w_mom` | `15.0` | Weight assigned to RSI, ROC, normalized momentum, and MACD. |
| `w_adx` | `10.0` | Weight assigned to directional movement (+DI / -DI spread) and ADX. |
| `w_rsiRegime` | `5.0` | Weight assigned to Cardwell bull/bear RSI range zones. |
| `w_vwap` | `5.0` | Weight assigned to price distance and slope relative to VWAP. |
| `w_volume` | `5.0` | Weight assigned to relative volume (RVOL) and Chaikin Money Flow. |
| `w_volatility`| `5.0` | Weight assigned to historical ATR percentile rank. |
| `w_zScore` | `5.0` | Weight assigned to contextual rolling price Z-score. |
| `w_curvature` | `5.0` | Weight assigned to second derivative price curvature. |
| `w_structure` | `10.0` | Weight assigned to Swing Highs/Lows and Break of Structure (BOS). |
| `w_er` | `5.0` | Weight assigned to Kaufman Price Efficiency Ratio. |

---

## 4. Technical Engine Settings
| Parameter | Default | Function |
| :--- | :--- | :--- |
| `fastEmaLen` | `9` | Period for fast moving average. |
| `medEmaLen` | `50` | Period for baseline trend filter moving average. |
| `slowEmaLen` | `200` | Period for macro moving average. |
| `useHma` | `true` | Enables Hull Moving Average for responsive slope detection. |
| `hmaLen` | `21` | Length for Hull Moving Average. |
| `htfTimeframe` | `"60"` | Higher timeframe resolution (e.g., 60m, 240m, 1D). |
| `htfStrictAntiRepaint` | `true` | Reads completed closed HTF candle `[1]` with `lookahead_off`. Guarantees 0% repainting. |
| `rsiLen` | `14` | RSI calculation period. |
| `normMomLen` | `10` | Lookback period for ATR-normalized momentum: `(close - close[n]) / ATR`. |
| `adxLen` | `14` | Welles Wilder ADX smoothing length. |
| `adxTrendLevel` | `25.0` | ADX threshold delineating strong trending from ranging regimes. |
| `atrLen` | `14` | Average True Range smoothing period. |
| `volPercentileLookback`| `100` | Lookback bars for rolling percentile rank of ATR and BB Width. |
| `zScoreLen` | `20` | Rolling lookback for Price Z-score mean and standard deviation. |
| `curvatureSmoothLen` | `3` | Smoothing EMA for Price Curvature second derivative. |
| `pivotLeftBars` / `Right` | `5` / `5` | Left and right bar clearance for pivot confirmation. |

---

## 5. Execution, Cooldown & Backtest Quality
| Parameter | Default | Function |
| :--- | :--- | :--- |
| `entryExecutionType` | `"Market"` | Options: `Market` (bar close), `Breakout` (stop order), `Pullback` (limit order). |
| `cooldownBars` | `3` | Minimum elapsed bars after an exit before a new entry is allowed. |
| `maxTradesPerDay` | `5` | Daily trade cap preventing overtrading during volatile whipsaws. |
| `enableDateFilter` | `false` | Restricts execution to a defined date window for walk-forward testing. |
