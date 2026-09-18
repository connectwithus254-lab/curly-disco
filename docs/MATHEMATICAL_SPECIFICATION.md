# Mathematical Specification: Adaptive Quantitative Market Regime Strategy (AQMRS)

## Abstract & Foundational Principles
The **Adaptive Quantitative Market Regime Strategy (AQMRS)** is a discrete-time, multi-factor algorithmic trading architecture designed in Pine Script v6 and TypeScript. It operates on scale-free, normalized quantitative variables to identify positive-expectancy trade opportunities across non-correlated asset classes (Cryptocurrency, Equities, Foreign Exchange, and Commodities) without overfitting to historical idiosyncrasies.

---

## 1. Core Mathematical Indicators & Formulations

### 1.1 True Range (TR) & Average True Range (ATR)
To ensure the strategy is invariant to the absolute price level of the underlying asset (e.g., $65,000 for BTC vs. $1.08 for EUR/USD), all volatility, distance, and momentum metrics are normalized by the Average True Range:

$$\text{TR}_t = \max\Big( H_t - L_t, \, |H_t - C_{t-1}|, \, |L_t - C_{t-1}| \Big)$$

ATR is smoothed via Wilder's Running Moving Average (RMA) with period $n = 14$:

$$\text{ATR}_t = \alpha \cdot \text{TR}_t + (1 - \alpha) \cdot \text{ATR}_{t-1}, \quad \text{where } \alpha = \frac{1}{n}$$

Safe ATR prevents division by zero in halted or zero-spread markets:
$$\text{ATR}^*_t = \max(\text{ATR}_t, \, 0.0001 \cdot C_t)$$

---

### 1.2 Trend Engine & Moving Average Formulations

#### Exponential Moving Average (EMA)
$$\text{EMA}_t(n) = \alpha \cdot C_t + (1 - \alpha) \cdot \text{EMA}_{t-1}(n), \quad \alpha = \frac{2}{n + 1}$$

The strategy maintains three primary EMAs:
- Fast: $n_{\text{fast}} = 9$
- Medium: $n_{\text{med}} = 50$
- Slow: $n_{\text{slow}} = 200$

#### Bullish / Bearish Alignment
$$\text{Align}_{\text{long}} = \mathbf{1}_{\{C_t > \text{EMA}_t(9) > \text{EMA}_t(50) > \text{EMA}_t(200)\}}$$
$$\text{Align}_{\text{short}} = \mathbf{1}_{\{C_t < \text{EMA}_t(9) < \text{EMA}_t(50) < \text{EMA}_t(200)\}}$$

#### Hull Moving Average (HMA)
Reduces lag while maintaining smoothness via weighted moving averages (WMA):
$$\text{HMA}_t(n) = \text{WMA}\Big( 2 \cdot \text{WMA}(C, \lfloor n/2 \rfloor) - \text{WMA}(C, n), \, \lfloor \sqrt{n} \rfloor \Big)$$

#### Normalized Trend Distance
$$\Delta_{\text{trend}} = \frac{\text{EMA}_t(9) - \text{EMA}_t(200)}{\text{ATR}^*_t}$$

---

### 1.3 Higher-Timeframe (HTF) Non-Repainting Security Formulation
To guarantee complete reproducibility and eliminate lookahead bias in historical backtests, all HTF data is requested using closed-bar indices:

$$\tilde{X}_{\text{HTF}}(t) = X_{\text{HTF}}(T-1)$$

Where $T-1$ is the timestamp of the **most recently completed closed candle** on the higher timeframe. In Pine Script v6:
```pinescript
[htfClose, htfFastEma, htfSlowEma] = request.security(
    syminfo.tickerid,
    htfTimeframe,
    [close[1], ta.ema(close, htfFastEmaLen)[1], ta.ema(close, htfSlowEmaLen)[1]],
    gaps = barmerge.gaps_off,
    lookahead = barmerge.lookahead_off
)
```
This guarantees that at time $t$ on the chart, the algorithm only observes data that was completely crystallized and unchangeable.

---

### 1.4 Momentum Engine

#### 1.4.1 Normalized Price Momentum
Measures raw price velocity over $k = 10$ bars expressed in ATR multiples:
$$M_{\text{norm}}(t) = \frac{C_t - C_{t-k}}{\text{ATR}^*_t}$$

#### 1.4.2 Normalized MACD Histogram
$$\text{MACD}_t = \text{EMA}_t(12) - \text{EMA}_t(26)$$
$$\text{Signal}_t = \text{EMA}_t(\text{MACD}, 9)$$
$$H_{\text{norm}}(t) = \frac{\text{MACD}_t - \text{Signal}_t}{\text{ATR}^*_t}$$

#### 1.4.3 Relative Strength Index (RSI)
$$\text{RS}_t = \frac{\text{RMA}(\max(C_t - C_{t-1}, 0), 14)}{\text{RMA}(\max(C_{t-1} - C_t, 0), 14)}$$
$$\text{RSI}_t = 100 - \frac{100}{1 + \text{RS}_t}$$

---

### 1.5 Welles Wilder Directional Movement Index (DMI / ADX)
Quantifies directional momentum and directional balance:
$$+\text{DM}_t = \begin{cases} H_t - H_{t-1} & \text{if } H_t - H_{t-1} > L_{t-1} - L_t \text{ and } H_t - H_{t-1} > 0 \\ 0 & \text{otherwise} \end{cases}$$
$$-\text{DM}_t = \begin{cases} L_{t-1} - L_t & \text{if } L_{t-1} - L_t > H_t - H_{t-1} \text{ and } L_{t-1} - L_t > 0 \\ 0 & \text{otherwise} \end{cases}$$
$$+\text{DI}_t = 100 \cdot \frac{\text{RMA}(+\text{DM}_t, 14)}{\text{ATR}_t}, \quad -\text{DI}_t = 100 \cdot \frac{\text{RMA}(-\text{DM}_t, 14)}{\text{ATR}_t}$$
$$\text{DX}_t = 100 \cdot \frac{|+\text{DI}_t - -\text{DI}_t|}{+\text{DI}_t + -\text{DI}_t}$$
$$\text{ADX}_t = \text{RMA}(\text{DX}_t, 14)$$

Normalized DI Spread:
$$\text{DI}_{\text{spread}} = \frac{+\text{DI}_t - -\text{DI}_t}{+\text{DI}_t + -\text{DI}_t}$$

---

### 1.6 Price Distribution & Rolling Z-Score
Evaluates how far the current price deviates from its rolling mean in units of sample standard deviation:

$$\mu_t(n) = \frac{1}{n}\sum_{i=0}^{n-1} C_{t-i}, \quad \sigma_t(n) = \sqrt{\frac{1}{n-1}\sum_{i=0}^{n-1} (C_{t-i} - \mu_t(n))^2}$$
$$Z_t = \frac{C_t - \mu_t(n)}{\sigma_t(n)}$$

#### Contextual Interpretation:
- **Trending Regime**: A moderately positive Z-score ($+0.5 \le Z \le +2.0$) confirms healthy trend momentum; an extreme Z-score ($Z > +3.0$) flags exhaustion.
- **Range Regime**: An extreme negative Z-score ($Z \le -2.0$) indicates statistical oversold conditions and potential mean-reverting bounce.

---

### 1.7 Price Curvature (Second-Order Price Derivative)
Price velocity is the first discrete difference $\Delta C_t = C_t - C_{t-1}$.
Price acceleration (curvature) is the discrete second derivative normalized by ATR:

$$\kappa_t^{\text{raw}} = \frac{\Delta C_t - \Delta C_{t-1}}{\text{ATR}^*_t} = \frac{(C_t - C_{t-1}) - (C_{t-1} - C_{t-2})}{\text{ATR}^*_t} = \frac{C_t - 2C_{t-1} + C_{t-2}}{\text{ATR}^*_t}$$

Smoothed via a 3-period EMA to attenuate single-tick microstructure noise:
$$\kappa_t = \text{EMA}(\kappa_t^{\text{raw}}, 3)$$

#### Interpretation:
- $\kappa_t > 0$: Price is convex upward (bullish acceleration or bearish deceleration).
- $\kappa_t < 0$: Price is concave downward (bearish acceleration or bullish deceleration).

---

### 1.8 Option Greeks & Proxies Architecture
When option chain data is available, external Greeks (Delta, Gamma, Theta, Implied Volatility) can be injected directly into the model. When unavailable (e.g. spot crypto or spot forex), the model calculates mathematically grounded proxies:

| Greek | Context | Mathematical Proxy Formulation |
| :--- | :--- | :--- |
| **Gamma Proxy** | Price Acceleration | Price Curvature: $\kappa_t = \frac{C_t - 2C_{t-1} + C_{t-2}}{\text{ATR}_t}$ |
| **Theta Proxy** | Volatility Decay | Range Decay Ratio: $\theta_{\text{proxy}} = -\max\Big(0, 1 - \frac{\max_{10}(H) - \min_{10}(L)}{10 \cdot \text{ATR}_t}\Big)$ |
| **Vega Proxy** | Historical Volatility Shock | ATR Percentile Rank: $\text{PercentRank}(\text{ATR}_t, 100)$ |

*Note: Proxies are explicitly labeled as statistical proxies and are never misrepresented as options-market clearing values.*

---

### 1.9 Kaufman Price Efficiency Ratio (ER)
Measures the directional linearity of price trajectory versus total path length:

$$\text{Net Change} = |C_t - C_{t-n}|$$
$$\text{Gross Path} = \sum_{i=0}^{n-1} |C_{t-i} - C_{t-i-1}|$$
$$\text{ER}_t = \frac{\text{Net Change}}{\text{Gross Path}} \in [0, 1]$$

- $\text{ER} \to 1.0$: Pure linear trend without retracement (maximum efficiency).
- $\text{ER} \to 0.0$: Pure Brownian noise / chaotic chop (zero efficiency).

---

### 1.10 Market Structure & Break of Structure (BOS)
Swing highs and lows are identified strictly after confirmation:

$$\text{PH}_t = \mathbf{1}_{\{ H_{t-R} = \max_{i \in [0, L+R]} H_{t-i} \}}$$
$$\text{PL}_t = \mathbf{1}_{\{ L_{t-R} = \min_{i \in [0, L+R]} L_{t-i} \}}$$

Where $L = 5$ (left bars) and $R = 5$ (right bars). A swing high is confirmed only after $R$ bars have closed.
- Bullish BOS: $C_t > \text{LastPivotHigh} \land C_{t-1} \le \text{LastPivotHigh}$
- Bearish BOS: $C_t < \text{LastPivotLow} \land C_{t-1} \ge \text{LastPivotLow}$

---

## 2. Six-State Market Regime Engine

At every bar $t$, the system aggregates volatility percentiles, trend efficiency, and directional movement into one of six mutually exclusive regimes:

1. **High Volatility (`HIGH_VOLATILITY`)**:
   $$\text{ATR}_{\%ile} \ge 80 \lor \text{BBW}_{\%ile} \ge 85$$
   *Adjustment*: Stop multiplier widened by +25%; entry threshold heightened by +4 points.
2. **Low Volatility / Squeeze (`LOW_VOLATILITY`)**:
   $$\text{ATR}_{\%ile} \le 20 \land \text{BBW}_{\%ile} \le 20$$
   *Adjustment*: Prepares for explosive expansion; break-even trigger lowered.
3. **Strong Trend (`STRONG_TREND`)**:
   $$\text{ADX}_t \ge 28 \land \text{ER}_t \ge 0.40 \land |\Delta_{\text{trend}}| \ge 1.0$$
   *Adjustment*: Target R:R expanded by $\times 1.35$; entry threshold eased by -3 points.
4. **Weak Trend (`WEAK_TREND`)**:
   $$(\text{ADX}_t \ge 18 \land \text{ER}_t \ge 0.25) \lor \text{Align}_{\text{long}} \lor \text{Align}_{\text{short}}$$
   *Adjustment*: Standard R:R ($2.0:1$); standard thresholds.
5. **Range (`RANGE`)**:
   $$\text{ADX}_t < 20 \land \text{ER}_t < 0.25 \land \neg \text{HighVol} \land \neg \text{LowVol}$$
   *Adjustment*: Target R:R compressed to $\times 0.75$ (quick mean-reversion harvest); entry threshold heightened by +3 points.
6. **Transition (`TRANSITION`)**:
   Default fallback state when directional and volatility signals are diverging.

---

## 3. Composite Multi-Factor Scoring Model

Long and Short scores are computed independently on a $[0, 100]$ scale:

$$S_{\text{Long}} = \frac{\sum_{k=1}^{12} w_k \cdot s_k^{\text{Long}}}{\sum_{k=1}^{12} w_k}, \quad S_{\text{Short}} = \frac{\sum_{k=1}^{12} w_k \cdot s_k^{\text{Short}}}{\sum_{k=1}^{12} w_k}$$

Where $w_k$ are the configurable factor weights:
- Trend: $w_1 = 15$
- HTF Trend: $w_2 = 15$
- Momentum: $w_3 = 15$
- ADX / Directional: $w_4 = 10$
- RSI Regime: $w_5 = 5$
- VWAP: $w_6 = 5$
- Volume / CMF: $w_7 = 5$
- Volatility Percentile: $w_8 = 5$
- Z-Score: $w_9 = 5$
- Price Curvature: $w_{10} = 5$
- Market Structure: $w_{11} = 10$
- Efficiency Ratio: $w_{12} = 5$

A trade is only authorized when:
$$S_{\text{Long}} \ge \Theta_{\text{Long}}^{\text{effective}} \quad \land \quad S_{\text{Long}} > S_{\text{Short}} + 10$$
with anti-contradiction, liquidity, and cooldown constraints satisfied.

---

## 4. Cycle Extremum / Turning-Point Quantitative Engine

To identify high-conviction cycle lowest points (troughs) and highest points (crests) without lookahead bias, the strategy evaluates a four-condition confluence filter strictly on bar close:

### 4.1 Statistical Band Exhaustion
Determines whether price has stretched into the outer tail of its rolling empirical distribution:
$$\text{Trough Exhaustion}: Z_t \le -Z_{\text{threshold}} \quad \lor \quad L_t \le \text{BB}_{\text{lower}, t}$$
$$\text{Crest Exhaustion}: Z_t \ge +Z_{\text{threshold}} \quad \lor \quad H_t \ge \text{BB}_{\text{upper}, t}$$

Where $Z_{\text{threshold}} = 1.5\sigma$ and $\text{BB}$ utilizes a 20-period rolling mean and 2.0 standard deviations.

### 4.2 Kinematic Curvature Inflection (Price Acceleration)
Evaluates whether the deceleration of the decline has ended and upward price acceleration has begun (2nd derivative inflection):
$$\kappa_t = \text{EMA}\left( \frac{C_t - 2 C_{t-1} + C_{t-2}}{\text{ATR}_t}, 3 \right)$$
$$\text{Bullish Curvature Turn}: \kappa_t > 0.02 \quad \lor \quad \kappa_t > \kappa_{t-1}$$
$$\text{Bearish Curvature Turn}: \kappa_t < -0.02 \quad \lor \quad \kappa_t < \kappa_{t-1}$$

### 4.3 Liquidity Absorption Rejection Wicks
Quantifies institutional order absorption at the candle boundaries:
$$\text{Lower Wick Ratio} = \frac{\min(O_t, C_t) - L_t}{\max(H_t - L_t, \epsilon)} \ge W_{\min} \quad (\text{default } 25\%)$$
$$\text{Upper Wick Ratio} = \frac{H_t - \max(O_t, C_t)}{\max(H_t - L_t, \epsilon)} \ge W_{\min} \quad (\text{default } 25\%)$$

### 4.4 Wilder RSI Turning Confirmation
Confirms that oversold/overbought momentum is turning back toward equilibrium:
$$\text{Trough Confirmation}: \text{RSI}_t \ge 25.0 \quad \land \quad \text{RSI}_t \ge \text{RSI}_{t-1}$$
$$\text{Crest Confirmation}: \text{RSI}_t \le 75.0 \quad \land \quad \text{RSI}_t \le \text{RSI}_{t-1}$$

When all four conditions converge, a cycle trough or crest is confirmed, allowing immediate entry at the cycle turning point.

---

## 5. News Catalyst & Macro Event Engine

### 5.1 Shock Detection Formulation
A high-impact news catalyst or macro event shock is flagged when volume and true range simultaneously undergo extreme statistical expansion:
$$\text{RVOL}_t = \frac{V_t}{\text{SMA}(V, 20)_t} \ge \Theta_{\text{RVOL}} \quad (\text{default } 2.2\times)$$
$$\Delta_{\text{Range}, t} = H_t - L_t \ge \Theta_{\text{ATR}} \cdot \text{ATR}_t \quad (\text{default } 1.8\times)$$

$$\text{NewsShock}_t = \mathbf{1}_{\{ \text{RVOL}_t \ge \Theta_{\text{RVOL}} \ \land \ \Delta_{\text{Range}, t} \ge \Theta_{\text{ATR}} \cdot \text{ATR}_t \}}$$

### 5.2 News Reaction Modes
1. **Fade Overreaction**:
   - Bottom capitulation: $C_t < C_{t-1} \land \text{Lower Wick Ratio} \ge 35\% \implies \text{Long Entry}$.
   - Parabolic blow-off: $C_t > C_{t-1} \land \text{Upper Wick Ratio} \ge 35\% \implies \text{Short Entry}$.
2. **Ride Momentum**:
   - Institutional continuation: $C_t > C_{t-1} \land \text{Sentiment}_{\text{macro}} \ge 0 \implies \text{Long Entry}$.
   - Liquidity cascade: $C_t < C_{t-1} \land \text{Sentiment}_{\text{macro}} \le 0 \implies \text{Short Entry}$.
3. **News Blackout**:
   - Inhibits all new order submissions during bars where $\text{NewsShock}_t = 1$, shielding the strategy from slippage and spread widening.

