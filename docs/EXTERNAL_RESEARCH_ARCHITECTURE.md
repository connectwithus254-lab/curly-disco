# External PineTS & TradingView-API Research Architecture

## 1. Architectural Philosophy
TradingView Pine Script is an outstanding charting and prototyping environment, but native Pine Script cannot:
- Run 1,000+ iteration parameter grid searches without hitting memory/runtime quotas.
- Automatically save and version hundreds of backtest run ledgers into JSON or relational databases.
- Perform walk-forward rolling window re-optimizations across multiple years of data.
- Run multi-asset Monte Carlo trade resampling.

To solve this, this repository establishes an **external quantitative research framework** in Node.js and TypeScript, referencing:
1. **LuxAlgo Open Source**: PineTS, pinets-cli, and Vela quantitative charting architecture.
2. **Mathieu2301 TradingView API** (`@mathieuc/tradingview`): External WebSocket data acquisition.

---

## 2. Component Layout & Interaction

```
                +---------------------------------------+
                |     TradingView WebSocket API         |
                |     (@mathieuc/tradingview)           |
                +-------------------+-------------------+
                                    |
                                    v
+-----------------------+   [Raw Candle Data]   +-----------------------+
|  Binance Public API   |---------> + <-------- |  Synthetic Generator  |
|  (data-api.binance)   |           |           |  (GBM + Jump Shocks)  |
+-----------------------+           |           +-----------------------+
                                    v
                      +---------------------------+
                      |   AQMRS Strategy Engine   |
                      |   (TypeScript / Node.js)  |
                      +-------------+-------------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
        v                           v                           v
+---------------+           +---------------+           +---------------+
| Walk-Forward  |           |  Monte Carlo  |           |   Parameter   |
| Optimization  |           |  Simulation   |           |   Stability   |
+---------------+           +---------------+           +---------------+
        |                           |                           |
        +---------------------------+---------------------------+
                                    |
                                    v
                      +---------------------------+
                      |  LuxAlgo PineTS & CLI     |
                      |  (pinets-cli Validation)  |
                      +---------------------------+
                                    |
                                    v
                      +---------------------------+
                      |  Production Pine v6 Code  |
                      |  (TradingView Strategy)   |
                      +---------------------------+
```

---

## 3. LuxAlgo PineTS & pinets-cli Integration

### 3.1 What is PineTS?
PineTS is an open-source TypeScript runtime and transpiler developed by LuxAlgo that executes TradingView Pine Script natively in JavaScript/TypeScript environments with identical time-series semantics (`lookback [n]`, incremental technical analysis, and plot output buffers).

### 3.2 Executing Indicators via pinets-cli
The repository includes a PineTS bridge (`src/pinets/pinetsBridge.ts`) and a companion indicator (`pine/AdaptiveQuantitativeMarketRegimeIndicator.pine`).

You can execute the Pine script directly against JSON candle streams:
```bash
npx pinets run pine/AdaptiveQuantitativeMarketRegimeIndicator.pine --data candles.json -n 50 -q
```
Or run the automated bridge through the CLI:
```bash
npm run cli -- pinets
```

---

## 4. TradingView API (@mathieuc/tradingview) Integration

### 4.1 Ingestion Flow
The `TradingViewProvider` class in `src/data/tvProvider.ts` interfaces with `@mathieuc/tradingview` to pull real-time or historical OHLCV data directly from TradingView's servers without an expensive institutional broker account:

```typescript
import { TradingViewProvider } from './src/data/tvProvider.js';

const candles = await TradingViewProvider.fetchCandles({
  symbol: 'BINANCE:BTCUSDT',
  timeframe: '15',
  range: 1000,
});
```

### 4.2 Offline Fallback Mechanism
Because sandboxed continuous integration (CI) environments and certain enterprise firewalls block outbound WebSocket connections, `TradingViewProvider` and `BinanceMarketProvider` include an automated fallback to the `SyntheticMarketGenerator`. This ensures that unit tests, parameter optimizations, and research pipelines run deterministically under all network conditions.
