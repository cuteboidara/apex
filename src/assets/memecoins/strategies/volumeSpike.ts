import type { Candle } from "@/src/smc/types";

export interface VolumeSpikeAnalysis {
  isSpike: boolean;
  spikeMultiplier: number;
  avgVolume20: number;
  currentVolume: number;
  spikeDirection: "bullish" | "bearish" | "neutral";
  spikeStrength: "extreme" | "strong" | "moderate" | "none";
  spikeScore: number;
  note: string;
}

export function detectVolumeSpike(
  candles: Candle[],
  threshold = 3,
): VolumeSpikeAnalysis {
  if (candles.length < 21) {
    return {
      isSpike: false,
      spikeMultiplier: 1,
      avgVolume20: 0,
      currentVolume: 0,
      spikeDirection: "neutral",
      spikeStrength: "none",
      spikeScore: 0,
      note: "Insufficient candle data",
    };
  }

  const recent = candles.slice(-21);
  const currentCandle = recent[recent.length - 1];
  const priorCandles = recent.slice(0, 20);
  const avgVolume20 = priorCandles.reduce((sum, candle) => sum + (candle.volume ?? 0), 0) / 20;
  const currentVolume = currentCandle.volume ?? 0;

  if (avgVolume20 === 0) {
    return {
      isSpike: false,
      spikeMultiplier: 1,
      avgVolume20: 0,
      currentVolume: 0,
      spikeDirection: "neutral",
      spikeStrength: "none",
      spikeScore: 0,
      note: "No volume data available",
    };
  }

  const spikeMultiplier = currentVolume / avgVolume20;
  const isSpike = spikeMultiplier >= threshold;
  const spikeDirection = currentCandle.close > currentCandle.open
    ? "bullish"
    : currentCandle.close < currentCandle.open
      ? "bearish"
      : "neutral";
  const spikeStrength = spikeMultiplier >= 10
    ? "extreme"
    : spikeMultiplier >= 5
      ? "strong"
      : spikeMultiplier >= threshold
        ? "moderate"
        : "none";
  const spikeScore = isSpike
    ? Math.min(100, Math.round(30 + ((spikeMultiplier - threshold) * 10)))
    : 0;
  const note = isSpike
    ? `Volume spike ${spikeMultiplier.toFixed(1)}x avg - ${spikeStrength} ${spikeDirection} momentum`
    : `Normal volume (${spikeMultiplier.toFixed(1)}x avg - threshold ${threshold}x)`;

  return {
    isSpike,
    spikeMultiplier,
    avgVolume20,
    currentVolume,
    spikeDirection,
    spikeStrength,
    spikeScore,
    note,
  };
}

export function deriveMemeSignal(
  volumeSpike: VolumeSpikeAnalysis,
  pdLocation: string,
  recentSweepSide: "buyside" | "sellside" | null,
  recentSweepReversal: boolean,
): { direction: "buy" | "sell" | "neutral"; confidence: number; primaryDriver: string } {
  if (volumeSpike.isSpike && recentSweepReversal) {
    const direction = recentSweepSide === "sellside"
      ? "buy"
      : recentSweepSide === "buyside"
        ? "sell"
        : volumeSpike.spikeDirection === "bullish"
          ? "buy"
          : "sell";
    return {
      direction,
      confidence: Math.min(0.82, 0.60 + (volumeSpike.spikeMultiplier * 0.03)),
      primaryDriver: "volume_spike_sweep_reversal",
    };
  }

  if (volumeSpike.isSpike) {
    const pdAligned = (volumeSpike.spikeDirection === "bullish" && pdLocation === "discount")
      || (volumeSpike.spikeDirection === "bearish" && pdLocation === "premium");
    const direction = volumeSpike.spikeDirection === "bullish"
      ? "buy"
      : volumeSpike.spikeDirection === "bearish"
        ? "sell"
        : "neutral";
    return {
      direction,
      confidence: pdAligned
        ? Math.min(0.75, 0.52 + (volumeSpike.spikeMultiplier * 0.02))
        : Math.min(0.62, 0.45 + (volumeSpike.spikeMultiplier * 0.01)),
      primaryDriver: pdAligned ? "volume_spike_pd_aligned" : "volume_spike_only",
    };
  }

  if (recentSweepReversal && (pdLocation === "discount" || pdLocation === "premium")) {
    const direction = recentSweepSide === "sellside"
      ? "buy"
      : recentSweepSide === "buyside"
        ? "sell"
        : "neutral";
    return {
      direction,
      confidence: 0.55,
      primaryDriver: "smc_sweep_reversal",
    };
  }

  return {
    direction: "neutral",
    confidence: 0,
    primaryDriver: "no_signal",
  };
}
