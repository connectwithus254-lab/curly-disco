# Pre-Live Trading Validation Checklist & Known Limitations

## 1. Known Limitations & Market Microstructure Considerations

Before allocating real capital to any quantitative strategy, the engineer must recognize inherent limitations:

1. **Intrabar Path Ambiguity**:
   Historical backtest candles only report Open, High, Low, Close. If both the Take Profit and Stop Loss lie between the bar's High and Low, historical backtests cannot know with certainty which price level was touched first. AQMRS conservatively assumes the Stop Loss was hit first, but live market ticks can still differ.
2. **Order Execution & Queue Priority**:
   Limit orders (Pullback entries) assume fills whenever price touches the limit price. In thin order books, your order may sit at the back of the queue and fail to fill as price bounces away.
3. **Execution Latency & Spread Widening**:
   During sudden macroeconomic releases (e.g. CPI, FOMC, Black Swan events), bid-ask spreads on crypto and forex widen by $5\times - 20\times$. Backtests using constant slippage will underestimate these costs.
4. **Regime Transition Lags**:
   Market regime switches (e.g., from low volatility consolidation to sudden directional breakout) require several bars to register on moving averages and ADX. The strategy is adaptive, but not omniscient.

---

## 2. Pre-Live Validation Checklist

Complete all 8 verification gates prior to live deployment:

### Gate 1: Code Verification & Anti-Repainting Audit
- [ ] Ensure `AdaptiveQuantitativeMarketRegimeStrategy.pine` compiles cleanly in TradingView Pine Script v6.
- [ ] Confirm `htfStrictAntiRepaint` is set to `true` (evaluates `[1]` offset on higher-timeframe data).
- [ ] Verify that pivot indicators require confirmed right-bar lag (default 5 bars).
- [ ] Confirm execution evaluates on confirmed bar closes (`calc_on_every_tick = false`).

### Gate 2: Data Quality & Sample Size
- [ ] Verify backtest encompasses at least $N \ge 200$ completed trades.
- [ ] Ensure backtest covers multiple distinct macroeconomic regimes:
  - Bull trend (e.g., 2020-2021 Crypto / 2023-2024 Equities)
  - Bear trend (e.g., 2022 Crypto / 2022 S&P 500)
  - Horizontal consolidation range (e.g., Summer 2023 BTC)
  - Elevated volatility spikes

### Gate 3: Friction & Sizing Realism
- [ ] Commission input is explicitly configured to your broker's tier (e.g., 0.05% for Binance/Bybit VIP0, or 0.02% for Maker).
- [ ] Slippage input reflects typical spread (at least 2 ticks for liquid instruments, 5-10 ticks for illiquid pairs).
- [ ] Position sizing is verified: `riskPerTradePct` must not exceed 1.0% - 2.0% of total liquid equity.

### Gate 4: Parameter Stability Verification
- [ ] Run parameter stability sweep:
  ```bash
  npm run cli -- stability
  ```
- [ ] Confirm the chosen parameter set resides on a **Broad Plateau** (Coefficient of Variation $< 0.40$).
- [ ] Confirm no "Overfitted Spike" warnings are triggered.

### Gate 5: Walk-Forward Efficiency (WFE)
- [ ] Run rolling walk-forward optimization:
  ```bash
  npm run cli -- walkforward
  ```
- [ ] Confirm Walk-Forward Efficiency $\text{WFE} \ge 0.50$.
- [ ] Confirm overall Out-Of-Sample expectancy is positive ($> 0$).

### Gate 6: Monte Carlo Tail Risk
- [ ] Run 1,000-iteration Monte Carlo simulation:
  ```bash
  npm run cli -- montecarlo
  ```
- [ ] Confirm 95th percentile max drawdown is within acceptable tolerance ($< 25\%$).
- [ ] Confirm 50% Ruin Probability is $< 1.0\%$.

### Gate 7: Cross-Market Portability
- [ ] Run cross-market validation:
  ```bash
  npm run cli -- crossmarket
  ```
- [ ] Confirm positive expectancy on at least 3 distinct asset classes without changing parameters.

### Gate 8: Forward Paper Trading
- [ ] Deploy strategy on TradingView Paper Trading account or webhook demo broker for a minimum of 4 weeks.
- [ ] Compare live paper execution fills against backtest fills for identical bars.
- [ ] Verify webhook alert payloads trigger properly and execute cleanly.
