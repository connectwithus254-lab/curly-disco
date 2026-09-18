# Adaptive Quantitative Market Regime Strategy (AQMRS)

[![Pine Script v6](https://img.shields.io/badge/Pine%20Script-v6-blue)](https://www.tradingview.com/pine-script-docs/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![PineTS Compatible](https://img.shields.io/badge/PineTS-0.9.34-green)](https://github.com/LuxAlgo/PineTS)
[![pinets-cli](https://img.shields.io/badge/pinets--cli-0.1.15-green)](https://github.com/LuxAlgo/pinets-cli)
[![Vitest](https://img.shields.io/badge/Tests-25%20Passed-brightgreen)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, mathematically grounded, non-repainting algorithmic trading system and quantitative research framework for TradingView **Pine Script v6**, **Node.js**, and **TypeScript**.

The objective of this strategy is **not** to curve-fit historical win rates or promise unrealistic 80%+ outcomes. The objective is to construct a scale-free, multi-factor adaptive scoring engine that seeks **positive mathematical expectancy**, **robust parameter plateaus**, and **controllable drawdowns** across non-correlated asset classes (Crypto, Forex, Equities, Commodities).

---

## 1. Architectural & Research References

This system is built using publicly available quantitative engineering standards and open-source ecosystems:

1. **LuxAlgo Open Source Quantitative Infrastructure**:
   - [LuxAlgo / PineTS](https://github.com/LuxAlgo/PineTS): Open-source JavaScript/TypeScript transpiler and runtime for TradingView Pine Script.
   - [LuxAlgo / pinets-cli](https://github.com/LuxAlgo/pinets-cli): Command-line utility to run Pine Script indicators against local datasets and streaming JSON feeds.
   - [LuxAlgo / Vela](https://github.com/LuxAlgo/Vela): Fast, extensible financial charting architecture.
   - *Notice: This strategy relies exclusively on publicly documented mathematical concepts and open APIs; no proprietary algorithms are accessed or reproduced.*

2. **Mathieu2301 TradingView API**:
   - [Mathieu2301 / TradingView-API (`@mathieuc/tradingview`)](https://github.com/Mathieu2301/TradingView-API): External WebSocket data acquisition layer for quantitative research.

---

## 2. Core Quantitative Architecture: 13 Factors

Each potential trade receives a quantitative score from 13 independent and semi-independent components. **Long** and **Short** scores are calculated separately on a normalized scale of `0 - 100`:

1. **Trend Engine**: Multi-EMA alignment (`9`, `50`, `200`), slope velocities, Hull Moving Average (`HMA`), and normalized distance in ATR multiples:
   $$\Delta_{\text{trend}} = \frac{\text{EMA}_{\text{fast}} - \text{EMA}_{\text{slow}}}{\text{ATR}}$$
2. **Higher-Timeframe (HTF) Trend**: Multi-timeframe trend filter requesting completed closed candles with `[1]` offset and `lookahead = barmerge.lookahead_off`. Blocks counter-HTF trades.
3. **Momentum Engine**: RSI, Rate of Change (ROC), normalized momentum $(\text{close} - \text{close}[n]) / \text{ATR}$, normalized MACD histogram, and distance from 50 EMA.
4. **Directional Movement / ADX**: Welles Wilder $+DI$, $-DI$, ADX strength, and normalized directional spread:
   $$\text{DI}_{\text{spread}} = \frac{+DI - -DI}{+DI + -DI}$$
5. **RSI Regime Context**: Andrew Cardwell range shifts: Bull regime ($40 - 80$), Bear regime ($20 - 60$), and contextual overbought/oversold filtering.
6. **VWAP Relationship**: Price distance from Volume-Weighted Average Price $(\text{close} - \text{VWAP}) / \text{ATR}$ and VWAP slope.
7. **Volume Confirmation**: Relative Volume ($\text{RVOL} = \text{volume} / \text{SMA}(\text{volume}, 20)$) and Chaikin Money Flow (CMF).
8. **Volatility Engine**: ATR, ATR percentage $(\text{ATR} / \text{close} \times 100)$, Bollinger Bandwidth, and rolling 100-bar percentile ranks:
   $$\text{ATR}_{\%ile} = \text{ta.percentrank}(\text{ATR}, 100)$$
9. **Price Distribution Z-Score**: Rolling Gaussian standardization:
   $$Z = \frac{\text{close} - \text{SMA}(\text{close}, n)}{\text{stdev}(\text{close}, n)}$$
   Evaluated contextually: trend continuation when trending; mean-reversion fade when ranging.
10. **Price Curvature (Second Derivative)**: Mathematically defined price acceleration:
    $$\kappa = \frac{\text{close} - 2 \cdot \text{close}[1] + \text{close}[2]}{\text{ATR}}$$
    Smoothed via a 3-period EMA to detect upward convexity (bullish acceleration) vs. downward concavity (bearish acceleration).
11. **Option Greeks & Proxies**: Capable of accepting external option chain Greeks (Delta, Gamma, Theta, IV). When external data is disabled, calculates mathematically grounded proxies (clearly labeled as proxies):
    - *Gamma Proxy*: Price Curvature
    - *Theta Proxy*: Range Volatility Decay
    - *Time Context*: Session duration decay
12. **Market Structure & BOS**: Swing Highs/Lows confirmed strictly after 5-bar right clearance. Detects Break of Structure (BOS) and Higher Highs/Lows.
13. **Kaufman Price Efficiency Ratio (ER)**: Directional efficiency metric:
    $$\text{ER} = \frac{|\text{close} - \text{close}[n]|}{\sum_{i=0}^{n-1} |\text{close}[i] - \text{close}[i+1]|}$$

---

## 3. The 6-State Adaptive Market Regime Engine

The strategy dynamically classifies market conditions into six distinct regimes and adapts its risk/reward and entry parameters:

| Regime | Mathematical Condition | Strategy Adaptation |
| :--- | :--- | :--- |
| **1. Strong Trend** | $\text{ADX} \ge 28 \land \text{ER} \ge 0.40 \land \|\Delta_{\text{trend}}\| \ge 1.0$ | Expands Take Profit Target ($1.35\times$ R:R); lowers entry threshold. |
| **2. Weak Trend** | $\text{ADX} \ge 18 \lor \text{EMAs aligned}$ | Standard R:R ($2.0:1$); standard entry filters. |
| **3. Range** | $\text{ADX} < 20 \land \text{ER} < 0.25$ | Tightens Take Profit Target ($0.75\times$ R:R) to harvest mean reversion; raises trend entry threshold. |
| **4. High Volatility** | $\text{ATR}_{\%ile} \ge 80 \lor \text{BBW}_{\%ile} \ge 85$ | Widens Stop Loss distance ($1.25\times$ ATR mult); lowers position size automatically via risk sizing. |
| **5. Low Volatility** | $\text{ATR}_{\%ile} \le 20 \land \text{BBW}_{\%ile} \le 20$ (Squeeze) | Monitors explosive breakout setups; tightens break-even trigger. |
| **6. Transition** | Diverging directional/volatility indicators | Heightens signal threshold; requires higher confidence. |

---

## 4. Strict Anti-Repainting Guarantees

- **No Future Data**: No negative lookahead indices (`close[-1]`).
- **Higher-Timeframe Security**: Uses `request.security(..., [close[1], ...], lookahead = barmerge.lookahead_off)`. Guarantees that historical backtests only observe previously completed HTF candles.
- **Pivot Confirmation**: Swing highs/lows are confirmed strictly $R$ bars after the pivot occurred.
- **Confirmed Bars Only**: Signals evaluate on `barstate.isconfirmed`. Real-time tick evaluation is strictly isolated to optional realtime mode.

---

## 5. Repository Structure

```
curly-disco/
├── README.md                                    # System Overview & Manual
├── package.json                                 # Node.js dependencies & scripts
├── tsconfig.json                                # TypeScript configuration
├── pine/
│   ├── AdaptiveQuantitativeMarketRegimeStrategy.pine   # Production Pine Script v6 Strategy
│   └── AdaptiveQuantitativeMarketRegimeIndicator.pine  # PineTS-compatible Indicator
├── src/
│   ├── index.ts                                 # Library exports
│   ├── cli.ts                                   # Research CLI Runner
│   ├── strategy/
│   │   ├── types.ts                             # Interfaces, types, default parameters
│   │   ├── indicators.ts                        # 13 technical & quantitative indicators
│   │   ├── regime.ts                            # 6-State Market Regime Engine
│   │   ├── scoring.ts                           # Multi-Factor Long & Short Scoring Model
│   │   └── engine.ts                            # Bar-by-bar State Machine & Risk Engine
│   ├── backtest/
│   │   ├── backtester.ts                        # Backtester with slippage & commission
│   │   └── metrics.ts                           # Sharpe, Sortino, Expectancy, Drawdown, CAGR
│   ├── validation/
│   │   ├── walkForward.ts                       # Walk-Forward Optimization & WFE calculator
│   │   ├── monteCarlo.ts                        # 1,000-run Bootstrap Resampling & Ruin Engine
│   │   ├── parameterStability.ts               # Parameter Plateau & Overfitting Detector
│   │   └── crossMarket.ts                       # Multi-Asset Robustness Engine
│   ├── data/
│   │   ├── syntheticProvider.ts                 # GBM + Stochastic Volatility Market Generator
│   │   ├── tvProvider.ts                        # TradingView WebSocket API Connector
│   │   └── binanceProvider.ts                   # Binance Public Kline Fetcher
│   └── pinets/
│       └── pinetsBridge.ts                      # LuxAlgo PineTS / pinets-cli Execution Bridge
├── test/
│   ├── indicators.test.ts                       # Indicator unit tests
│   ├── regime.test.ts                           # Regime classification tests
│   └── backtest.test.ts                         # Backtest, WFO & Monte Carlo tests
└── docs/
    ├── MATHEMATICAL_SPECIFICATION.md            # Formulas, derivations & proofs
    ├── INPUTS_REFERENCE.md                      # Parameter dictionary
    ├── BACKTESTING_METHODOLOGY.md               # Anti-repainting & metrics guide
    ├── WALK_FORWARD_AND_MONTE_CARLO.md          # WFO & bootstrap methodology
    ├── EXTERNAL_RESEARCH_ARCHITECTURE.md        # PineTS & TradingView API guide
    └── VALIDATION_CHECKLIST.md                  # Pre-live trading 8-gate checklist
```

---

## 6. Quickstart & CLI Commands

### 6.1 Installation
```bash
npm install
npm run build
```

### 6.2 Running Automated Unit Tests
```bash
npm test
```

### 6.3 Running Backtests
Simulate the strategy over 1,200 bars with realistic commissions and slippage:
```bash
npm run cli -- backtest
```

### 6.4 Running Parameter Grid Sweeps
Evaluate parameter combinations for Sharpe, Profit Factor, and Drawdown:
```bash
npm run cli -- optimize
```

### 6.5 Running Walk-Forward Optimization (WFO)
Partitions data into rolling Train (70%) and Test (30%) windows and calculates Walk-Forward Efficiency (WFE):
```bash
npm run cli -- walkforward
```

### 6.6 Running Monte Carlo Resampling
Resample 1,000 trade sequence iterations with replacement to quantify tail risk ($P_{95}, P_{99}$) and Probability of Ruin:
```bash
npm run cli -- montecarlo
```

### 6.7 Running Parameter Stability Tests
Evaluates whether optimal parameters reside on a broad, flat plateau or an overfitted razor-edge spike:
```bash
npm run cli -- stability
```

### 6.8 Running Cross-Market Robustness Validation
Tests parameter portability across Bitcoin, Ethereum, EUR/USD, S&P 500, and Gold:
```bash
npm run cli -- crossmarket
```

### 6.9 Running Companion Indicator via LuxAlgo pinets-cli
Executes the Pine Script companion indicator directly using PineTS:
```bash
npm run cli -- pinets
```

---

## 7. Webhook & Automation JSON Alerts

When executing on TradingView, AQMRS automatically dispatches structured JSON payloads for webhook automations (e.g., 3Commas, Alertatron, custom execution bots):

```json
{
  "strategy": "AQMRS",
  "event": "ENTRY_LONG",
  "symbol": "BTCUSDT",
  "tf": "15",
  "price": 64250.00,
  "sl": 63100.00,
  "tp": 66550.00,
  "score": 78.4,
  "regime": "Strong Trend",
  "adx": 31.2
}
```

---

## 8. License & Disclaimer

Distributed under the **MIT License**.

*Disclaimer: Algorithmic trading involves substantial risk of loss. This software is provided for quantitative research and educational purposes only. Past performance, backtests, and Walk-Forward simulations do not guarantee future results.*
