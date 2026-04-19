// app/api/indices/amt/correlation/route.ts
// GET — static 30-day rolling correlation matrix for all 7 assets

import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

// Well-known approximate correlations between AMT universe assets (30d rolling avg)
const CORRELATION_PAIRS = [
  // Index ↔ Index
  { asset1: 'NAS100', asset2: 'SPX500', correlation: 0.97 },
  { asset1: 'NAS100', asset2: 'DAX',    correlation: 0.72 },
  { asset1: 'SPX500', asset2: 'DAX',    correlation: 0.75 },

  // Index ↔ Forex (risk-on / USD flows)
  { asset1: 'NAS100', asset2: 'EURUSD', correlation: 0.65 },
  { asset1: 'NAS100', asset2: 'GBPUSD', correlation: 0.60 },
  { asset1: 'NAS100', asset2: 'USDJPY', correlation: 0.55 },
  { asset1: 'NAS100', asset2: 'AUDUSD', correlation: 0.70 },
  { asset1: 'SPX500', asset2: 'EURUSD', correlation: 0.62 },
  { asset1: 'SPX500', asset2: 'GBPUSD', correlation: 0.58 },
  { asset1: 'SPX500', asset2: 'USDJPY', correlation: 0.52 },
  { asset1: 'SPX500', asset2: 'AUDUSD', correlation: 0.68 },
  { asset1: 'DAX',    asset2: 'EURUSD', correlation: 0.68 },
  { asset1: 'DAX',    asset2: 'GBPUSD', correlation: 0.55 },
  { asset1: 'DAX',    asset2: 'USDJPY', correlation: 0.40 },
  { asset1: 'DAX',    asset2: 'AUDUSD', correlation: 0.58 },

  // Forex ↔ Forex
  { asset1: 'EURUSD', asset2: 'GBPUSD', correlation:  0.85 },
  { asset1: 'EURUSD', asset2: 'USDJPY', correlation: -0.65 },
  { asset1: 'EURUSD', asset2: 'AUDUSD', correlation:  0.75 },
  { asset1: 'GBPUSD', asset2: 'USDJPY', correlation: -0.60 },
  { asset1: 'GBPUSD', asset2: 'AUDUSD', correlation:  0.72 },
  { asset1: 'USDJPY', asset2: 'AUDUSD', correlation: -0.45 },
];

export async function GET() {
  return NextResponse.json({ ok: true, pairs: CORRELATION_PAIRS });
}
