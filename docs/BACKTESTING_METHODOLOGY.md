# Backtesting Methodology & Overfitting Protection Guide

## 1. The Core Quantitative Objective
The primary failure mode of retail algorithmic trading is optimizing for **historical win rate** rather than **positive mathematical expectancy** and **parameter stability**.

An algorithm that displays an 80%+ historical win rate in TradingView backtests almost invariably suffers from one or more fatal flaws:
1. **Lookahead Bias / Repainting**: Accessing future bar closes, higher-timeframe data before it closes, or unconfirmed pivots.
2. **Asymmetric Risk/Reward Trap**: Risking 10 units to make 1 unit (e.g. 500-tick stop loss with 10-tick take profit). A high win rate with catastrophic tail risk.
3. **Data Snooping & Selection Bias**: Tweaking parameters until they fit historical noise on a single asset and timeframe.
4. **Unrealistic Fills & Friction Neglect**: Assuming limit orders fill at exact prices during high volatility, ignoring bid-ask spread, slippage, and exchange commissions.

AQMRS is explicitly engineered to eliminate these pitfalls.

---

## 2. Eliminating Repainting & Lookahead Bias

### 2.1 The Higher-Timeframe Security Vulnerability
In Pine Script, using `request.security()` with default parameters or `lookahead = barmerge.lookahead_on` on historical bars fetches the higher-timeframe bar's **final close** before the current lower-timeframe bar has closed.

**The AQMRS Anti-Repaint Standard**:
```pinescript
[htfClose, htfFastEma, htfSlowEma] = request.security(
    syminfo.tickerid,
    htfTimeframe,
    [close[1], ta.ema(close, htfFastEmaLen)[1], ta.ema(close, htfSlowEmaLen)[1]],
    gaps = barmerge.gaps_off,
    lookahead = barmerge.lookahead_off
)
```
- Requesting `expression[1]` forces the security call to sample the **completed, closed candle** from the previous HTF period.
- `lookahead = barmerge.lookahead_off` forbids TradingView's backtester from peeking ahead.

### 2.2 Non-Repainting Pivot Detection
Using `ta.pivothigh(high, 5, 5)` returns a non-NaN value on bar index $i$ **only after 5 bars have closed** following the candidate peak. AQMRS only updates structure lines and signals on the confirmation bar, ensuring zero lookahead.

### 2.3 Bar Confirmation Mode
All signal evaluations occur on `barstate.isconfirmed`. The strategy does not trigger temporary intrabar signals that vanish before the bar closes.

---

## 3. Slippage, Commissions & Friction Modeling

In realistic backtesting, friction compound exponentially:
- **Crypto Perps**: 0.04% - 0.06% taker fee per side + 1-2 ticks slippage.
- **Forex**: 0.5 - 1.5 pips spread + financing.
- **Equities**: $0.005/share or 0.05% + exchange clearing fees.

In AQMRS:
- Commission is set to `0.05%` per side by default.
- Slippage is modeled as `2 ticks`.
- Intrabar exit fills evaluate worst-case: if high touches target and low touches stop in the same bar, the stop loss is assumed to have triggered first.

---

## 4. Statistical Metrics Beyond Win Rate

| Metric | Formula | Target Threshold | Interpretation |
| :--- | :--- | :--- | :--- |
| **Expectancy ($)** | $(W\% \times \text{AvgWin}) - (L\% \times \text{AvgLoss})$ | $> 0$ | Average expected dollar return per trade. |
| **Expectancy Ratio (E/R)** | $\text{Expectancy} / \text{AvgLoss}$ | $> 0.25$ | Return normalized by unit risk. |
| **Profit Factor (PF)** | $\text{Gross Profit} / \text{Gross Loss}$ | $> 1.40$ | Ratio of cumulative wins to cumulative losses. |
| **Annualized Sharpe** | $\frac{\mu_r - r_f}{\sigma_r} \cdot \sqrt{N}$ | $> 1.00$ | Risk-adjusted return relative to total volatility. |
| **Annualized Sortino** | $\frac{\mu_r - r_f}{\sigma_{\text{downside}}} \cdot \sqrt{N}$ | $> 1.50$ | Risk-adjusted return penalizing only downside volatility. |
| **Max Drawdown %** | $\max \Big( \frac{\text{Peak} - \text{Trough}}{\text{Peak}} \Big)$ | $< 15\%$ | Worst peak-to-trough capital decline. |
| **Sample Size ($N$)** | Total completed trades | $> 150$ | Minimum sample size for statistical significance. |

---

## 5. The Overfitting Protection Pipeline

```
TRAINING DATA (70%)
         ↓
PARAMETER SEARCH (Grid / Random)
         ↓
VALIDATION DATA (30%)
         ↓
WALK-FORWARD ROLLING ANALYSIS
         ↓
OUT-OF-SAMPLE TEST
         ↓
MONTE CARLO RESAMPLING (1,000+ runs)
         ↓
CROSS-MARKET PORTABILITY (BTC, ETH, EUR, SPY, Gold)
         ↓
FINAL PRODUCTION DEPLOYMENT
```

Never calibrate parameters on the full dataset. Always reserve the most recent 20-30% of data for unadulterated Out-Of-Sample validation.
