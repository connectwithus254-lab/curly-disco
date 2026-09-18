# Walk-Forward Optimization & Monte Carlo Resampling

This guide explains how to execute rigorous Walk-Forward Optimization (WFO) and Monte Carlo trade sequence resampling using the AQMRS research framework.

---

## 1. Walk-Forward Optimization (WFO)

### 1.1 Why Standard Backtests Lie
Standard static backtesting optimizes parameters over the entire dataset $[0, T]$. This produces **in-sample memorization**: the optimizer chooses parameters that capitalized on specific historical volatility spikes or unusual price moves that will not repeat.

### 1.2 The Rolling Window Architecture
Walk-Forward Optimization solves this by partitioning historical data into rolling, sequential windows:

```
Window 1: [--- Train 70% ---][-- Test 30% --]
Window 2:        [--- Train 70% ---][-- Test 30% --]
Window 3:               [--- Train 70% ---][-- Test 30% --]
Window 4:                      [--- Train 70% ---][-- Test 30% --]
```

1. **Step 1 (In-Sample Training)**: Grid sweep is conducted strictly on the Training slice.
2. **Step 2 (Selection)**: The parameter set maximizing Sharpe and Profit Factor on a stable plateau is selected.
3. **Step 3 (Out-Of-Sample Execution)**: The selected parameters are executed strictly forward in time on the unseen Test slice.
4. **Step 4 (Stitching)**: All Out-Of-Sample test trades are concatenated into a single unbroken equity curve.

### 1.3 Walk-Forward Efficiency (WFE)
Walk-Forward Efficiency is the fundamental metric of strategy viability:

$$\text{WFE} = \frac{\text{Annualized Sharpe}_{\text{Out-Of-Sample}}}{\text{Annualized Sharpe}_{\text{In-Sample}}}$$

#### Benchmarks:
- **$\text{WFE} \ge 0.60$**: Excellent statistical persistence; low overfitting.
- **$0.40 \le \text{WFE} < 0.60$**: Acceptable robustness.
- **$\text{WFE} < 0.40$**: Overfitted to historical noise; will fail in live trading.

### 1.4 CLI Execution
```bash
npm run cli -- walkforward
```

---

## 2. Monte Carlo Resampling & Tail Risk Analysis

### 2.1 The Dependency Problem in Trade Sequences
A backtest only shows **one realized path** out of an infinite number of paths that could have occurred with the same statistical distribution.

If your strategy experienced 100 trades with 50 wins and 50 losses, what would happen if 10 losses occurred consecutively?
- In the historical sequence, losses might have been evenly dispersed.
- In live trading, a cluster of losses can trigger margin liquidation or account destruction.

### 2.2 Bootstrap Resampling Methodology
The AQMRS Monte Carlo engine resamples completed trades with replacement over $B = 1,000$ iterations:

1. For iteration $b \in [1, B]$:
   - Sample $N$ trades randomly with replacement from the realized trade pool.
   - Reconstruct the cumulative equity curve from the resampled sequence.
   - Record maximum drawdown percentage, final equity, and longest losing streak.
2. Construct the probability distribution across all $B$ iterations:
   - **Median Max Drawdown ($P_{50}$)**: The typical expected drawdown.
   - **95th Percentile Max Drawdown ($P_{95}$)**: The 1-in-20 tail risk drawdown.
   - **99th Percentile Max Drawdown ($P_{99}$)**: The extreme worst-case scenario.

### 2.3 Probability of Ruin
$$\text{Probability of Ruin} = \frac{\text{Count}(\text{Drawdown}_{\text{max}} \ge \text{Threshold})}{B} \times 100\%$$

Where the default ruin threshold is $50\%$ account drawdown. A viable quantitative strategy must maintain a $50\%$ Ruin Probability of $< 1.0\%$.

### 2.4 CLI Execution
```bash
npm run cli -- montecarlo
```
