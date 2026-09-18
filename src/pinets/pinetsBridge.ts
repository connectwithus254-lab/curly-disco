/**
 * Adaptive Quantitative Market Regime Strategy (AQMRS)
 * LuxAlgo PineTS & pinets-cli Research Bridge
 *
 * Provides external research tooling to run and validate Pine Script logic
 * in local Node.js environments using PineTS runtime.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { Candle } from '../strategy/types.js';

const execAsync = promisify(exec);

export interface PineTsRunOptions {
  scriptPath: string;
  candles: Candle[];
  candlesCount?: number;
  warmupCount?: number;
}

export interface PineTsRunResult {
  success: boolean;
  plots?: Record<string, any>;
  indicator?: Record<string, any>;
  rawOutput?: string;
  error?: string;
}

export class PineTsBridge {
  /**
   * Executes a Pine script indicator using pinets-cli against a supplied candle array
   */
  public static async runScriptWithData(
    options: PineTsRunOptions
  ): Promise<PineTsRunResult> {
    const { scriptPath, candles, candlesCount = candles.length, warmupCount = 0 } = options;

    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `Pine script file not found at: ${scriptPath}`,
      };
    }

    // Prepare JSON candle file formatted for pinets-cli
    const tempCandlePath = path.resolve(process.cwd(), `.temp-candles-${Date.now()}.json`);
    const formattedCandles = candles.map((c) => ({
      openTime: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      closeTime: c.time + 15 * 60 * 1000 - 1,
    }));

    try {
      fs.writeFileSync(tempCandlePath, JSON.stringify(formattedCandles, null, 2), 'utf8');

      const cmd = `npx pinets run "${scriptPath}" --data "${tempCandlePath}" -n ${candlesCount} -w ${warmupCount} -q`;
      const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

      // Clean up temp file
      if (fs.existsSync(tempCandlePath)) {
        fs.unlinkSync(tempCandlePath);
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        return {
          success: true,
          plots: parsed.plots,
          indicator: parsed.indicator,
          rawOutput: stdout,
        };
      } catch (jsonErr) {
        return {
          success: false,
          rawOutput: stdout,
          error: `Failed to parse pinets JSON output: ${(jsonErr as Error).message}`,
        };
      }
    } catch (err) {
      if (fs.existsSync(tempCandlePath)) {
        fs.unlinkSync(tempCandlePath);
      }
      return {
        success: false,
        error: `PineTS CLI execution failed: ${(err as Error).message}`,
      };
    }
  }
}
