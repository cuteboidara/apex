"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

type OverlayLevel = {
  key: string;
  label: string;
  price: number;
  color: string;
  dashed?: boolean;
};

type Props = {
  candles: Candle[];
  overlayLevels?: OverlayLevel[];
};

function toSeconds(ts: number): UTCTimestamp {
  // timestamp > 1e12 means milliseconds; otherwise already seconds
  return Math.floor(ts > 1e12 ? ts / 1000 : ts) as UTCTimestamp;
}

export function LightweightChart({ candles, overlayLevels = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#000000" },
        textColor:  "#666666",
      },
      grid: {
        vertLines: { color: "#1a1a1a" },
        horzLines: { color: "#1a1a1a" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#1a1a1a",
      },
      timeScale: {
        borderColor:  "#1a1a1a",
        timeVisible:  true,
        fixLeftEdge:  true,
        fixRightEdge: true,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor:       "#00ff88",
      downColor:     "#ff4444",
      borderVisible: false,
      wickUpColor:   "#00ff88",
      wickDownColor: "#ff4444",
    });

    const data = candles.map(c => ({
      time:  toSeconds(c.timestamp),
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }));

    candleSeries.setData(data);

    // Price-line overlays for entry / stop / TP levels
    for (const level of overlayLevels) {
      candleSeries.createPriceLine({
        price:              level.price,
        color:              level.color,
        lineWidth:          1,
        lineStyle:          level.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible:   true,
        title:              level.label,
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, overlayLevels]);

  return <div ref={containerRef} className="w-full h-[420px]" />;
}
