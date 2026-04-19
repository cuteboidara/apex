'use client';
// src/presentation/indices/components/TradingViewChart.tsx
// Embeds a TradingView Advanced Chart widget for a given asset + signal levels

import { useEffect, useRef, useState } from 'react';

interface SignalLevels {
  entryHigh: number;
  entryLow: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  direction: 'long' | 'short';
}

interface TradingViewChartProps {
  symbol: string;        // APEX asset ID, e.g. "EURUSD", "NAS100"
  interval?: string;     // '60' | '240' | 'D' | 'W'  (default: '240' = 4H)
  theme?: 'dark' | 'light';
  height?: number;
  signal?: SignalLevels;
}

// Map APEX asset IDs → TradingView symbols
const SYMBOL_MAP: Record<string, string> = {
  // FX
  EURUSD:   'FX:EURUSD',
  GBPUSD:   'FX:GBPUSD',
  USDJPY:   'FX:USDJPY',
  AUDUSD:   'FX:AUDUSD',
  USDCAD:   'FX:USDCAD',
  USDCHF:   'FX:USDCHF',
  EURJPY:   'FX:EURJPY',
  GBPJPY:   'FX:GBPJPY',
  // Indices
  NAS100:   'NASDAQ:NDX',
  SPX500:   'SP:SPX',
  DAX:      'XETR:DAX',
  FTSE100:  'LSE:UKX',
  NIKKEI:   'TVC:NI225',
  HANGSENG: 'TVC:HSI',
  CAC40:    'EURONEXT:PX1',
  ASX200:   'ASX:XJO',
  // Commodities
  XAUUSD:   'TVC:GOLD',
  XAGUSD:   'TVC:SILVER',
  USOIL:    'TVC:USOIL',
  UKOIL:    'TVC:UKOIL',
  NATGAS:   'TVC:NATURALGAS',
  COPPER:   'TVC:COPPER',
  // Rates
  US10Y:    'TVC:US10Y',
  US2Y:     'TVC:US02Y',
  DE10Y:    'TVC:DE10Y',
  JP10Y:    'TVC:JP10Y',
  UK10Y:    'TVC:GB10Y',
};

const TF_LABELS: Record<string, string> = {
  '60':  '1H',
  '240': '4H',
  'D':   'D',
  'W':   'W',
};

function fmtLevel(price: number): string {
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100)   return price.toFixed(2);
  if (price >= 10)    return price.toFixed(3);
  return price.toFixed(5);
}

export function TradingViewChart({
  symbol,
  interval: initialInterval = '240',
  theme = 'dark',
  height = 500,
  signal,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState(initialInterval);

  const tvSymbol = SYMBOL_MAP[symbol] ?? `FX:${symbol}`;
  // Stable unique container ID per symbol instance
  const containerId = `tv-chart-${symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const scriptId = `tv-script-${containerId}`;
    // Remove any prior script for this chart
    document.getElementById(scriptId)?.remove();

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;

    script.onload = () => {
      const TV = (window as unknown as Record<string, unknown>).TradingView as
        { widget: new (cfg: Record<string, unknown>) => unknown } | undefined;
      if (!TV || !containerRef.current) return;

      new TV.widget({
        container_id: containerId,
        symbol: tvSymbol,
        interval,
        timezone: 'UTC',
        theme,
        style: '1',            // Candlestick
        locale: 'en',
        toolbar_bg: '#161b22',
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        height,
        width: '100%',
        studies: [
          'Volume@tv-basicstudies',
          'VWAP@tv-basicstudies',
          'BB@tv-basicstudies',
          'RSI@tv-basicstudies',
        ],
        overrides: {
          'paneProperties.background':                 '#0d1117',
          'paneProperties.vertGridProperties.color':   '#21262d',
          'paneProperties.horzGridProperties.color':   '#21262d',
          'scalesProperties.textColor':                '#8b949e',
          'candleStyle.upColor':                       '#3fb950',
          'candleStyle.downColor':                     '#f85149',
          'candleStyle.wickUpColor':                   '#3fb950',
          'candleStyle.wickDownColor':                 '#f85149',
        },
      });
    };

    document.head.appendChild(script);

    return () => {
      script.onload = null;
      document.getElementById(scriptId)?.remove();
    };
  }, [tvSymbol, interval, theme, containerId, height]);

  return (
    <div className="w-full rounded-lg overflow-hidden border border-[#30363d]">

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-bold text-white">{symbol}</span>
          <span className="text-xs font-mono text-[#8b949e]">
            {TF_LABELS[interval] ?? interval} · AMT ANALYSIS
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Timeframe switcher */}
          {(['60', '240', 'D', 'W'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setInterval(tf)}
              className={[
                'text-[10px] font-mono px-2 py-0.5 rounded transition-colors',
                interval === tf
                  ? 'bg-white text-black'
                  : 'text-[#8b949e] hover:text-white',
              ].join(' ')}
            >
              {TF_LABELS[tf]}
            </button>
          ))}

          {/* Open in TradingView */}
          <a
            href={`https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-[10px] font-mono px-2 py-0.5 rounded border border-[#30363d] text-[#8b949e] hover:text-[#58a6ff] hover:border-[#58a6ff]/50 transition-colors"
          >
            FULL →
          </a>
        </div>
      </div>

      {/* ── Signal levels strip ── */}
      {signal && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-[#0d1117] border-b border-[#30363d] text-[10px] font-mono">
          <span className="text-[#8b949e]">ENTRY</span>
          <span className="text-white">
            {fmtLevel(signal.entryLow)} – {fmtLevel(signal.entryHigh)}
          </span>

          <span className="text-[#8b949e]">SL</span>
          <span className="text-[#f85149]">{fmtLevel(signal.stopLoss)}</span>

          <span className="text-[#8b949e]">TP1</span>
          <span className="text-[#3fb950]">{fmtLevel(signal.tp1)}</span>

          <span className="text-[#8b949e]">TP2</span>
          <span className="text-[#3fb950]">{fmtLevel(signal.tp2)}</span>

          <span className="text-[#8b949e]">TP3</span>
          <span className="text-[#3fb950]">{fmtLevel(signal.tp3)}</span>

          <span className={[
            'ml-auto px-2 py-0.5 rounded border',
            signal.direction === 'long'
              ? 'bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/30'
              : 'bg-[#f85149]/10 text-[#f85149] border-[#f85149]/30',
          ].join(' ')}>
            {signal.direction === 'long' ? '↑ LONG' : '↓ SHORT'}
          </span>
        </div>
      )}

      {/* ── TradingView widget container ── */}
      <div
        id={containerId}
        ref={containerRef}
        style={{ height: `${height}px` }}
        className="w-full bg-[#0d1117]"
      />
    </div>
  );
}
