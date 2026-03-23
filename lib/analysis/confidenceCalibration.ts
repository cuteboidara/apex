export type CalibrationOutcomeRecord = {
  symbol: string;
  assetClass: string;
  style: string;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  providerHealthState: string | null;
  confidence: number;
  realizedRR: number | null;
  closedAt?: Date | null;
};

export type CalibrationBucket = {
  scopeType: string;
  symbol: string | null;
  assetClass: string | null;
  style: string | null;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  confidenceMin: number;
  confidenceMax: number;
  sampleSize: number;
  winRate: number | null;
  averageRR: number | null;
  expectancy: number | null;
};

export type StrategyWindow = {
  scopeType: string;
  symbol: string | null;
  assetClass: string | null;
  style: string | null;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  providerHealthState: string | null;
  sampleSize: number;
  winRate: number | null;
  averageRR: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
  confidenceMean: number | null;
};

export type EvidenceGateRule = {
  scopeType: string;
  key: string;
  label: string;
  symbol: string | null;
  style: string | null;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  sampleSize: number;
  winRate: number | null;
  averageRR: number | null;
  expectancy: number | null;
  reason: string;
};

function round(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function expectancy(records: CalibrationOutcomeRecord[]) {
  const resolved = records
    .map(record => record.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (resolved.length === 0) return null;
  return resolved.reduce((sum, value) => sum + value, 0) / resolved.length;
}

function winRate(records: CalibrationOutcomeRecord[]) {
  const resolved = records
    .map(record => record.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (resolved.length === 0) return null;
  return resolved.filter(value => value > 0).length / resolved.length;
}

function averageRR(records: CalibrationOutcomeRecord[]) {
  return expectancy(records);
}

function maxDrawdown(records: CalibrationOutcomeRecord[]) {
  const resolved = records
    .map(record => record.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (resolved.length === 0) return null;

  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const value of resolved) {
    equity += value;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity - peak);
  }
  return worst;
}

function meanConfidence(records: CalibrationOutcomeRecord[]) {
  if (records.length === 0) return null;
  return records.reduce((sum, record) => sum + record.confidence, 0) / records.length;
}

function groupBy<T>(items: T[], makeKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = makeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return groups;
}

function makeScopeKey(scopeType: string, input: Record<string, string | null>) {
  return `${scopeType}:${Object.entries(input).map(([key, value]) => `${key}=${value ?? "*"}`).join("|")}`;
}

export function buildConfidenceCalibrationBuckets(
  records: CalibrationOutcomeRecord[],
  input?: {
    bucketSize?: number;
    scopeType?: string;
    style?: string | null;
    symbol?: string | null;
    assetClass?: string | null;
    setupFamily?: string | null;
    regimeTag?: string | null;
    provider?: string | null;
  }
): CalibrationBucket[] {
  const bucketSize = Math.min(25, Math.max(5, input?.bucketSize ?? 10));
  const buckets = new Map<number, CalibrationOutcomeRecord[]>();

  for (const record of records) {
    const lower = Math.max(0, Math.floor(record.confidence / bucketSize) * bucketSize);
    if (!buckets.has(lower)) buckets.set(lower, []);
    buckets.get(lower)!.push(record);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([confidenceMin, bucketRecords]) => ({
      scopeType: input?.scopeType ?? "GLOBAL",
      symbol: input?.symbol ?? null,
      assetClass: input?.assetClass ?? null,
      style: input?.style ?? null,
      setupFamily: input?.setupFamily ?? null,
      regimeTag: input?.regimeTag ?? null,
      provider: input?.provider ?? null,
      confidenceMin,
      confidenceMax: confidenceMin + bucketSize - 1,
      sampleSize: bucketRecords.length,
      winRate: round(winRate(bucketRecords)),
      averageRR: round(averageRR(bucketRecords)),
      expectancy: round(expectancy(bucketRecords)),
    }));
}

export function buildStrategyPerformanceWindows(records: CalibrationOutcomeRecord[]): StrategyWindow[] {
  const scopes = [
    {
      scopeType: "GLOBAL",
      group: () => "GLOBAL",
      shape: (_records: CalibrationOutcomeRecord[]) => ({
        symbol: null,
        assetClass: null,
        style: null,
        setupFamily: null,
        regimeTag: null,
        provider: null,
        providerHealthState: null,
      }),
    },
    {
      scopeType: "SYMBOL_STYLE",
      group: (record: CalibrationOutcomeRecord) => `${record.symbol}:${record.style}`,
      shape: (scopeRecords: CalibrationOutcomeRecord[]) => ({
        symbol: scopeRecords[0]?.symbol ?? null,
        assetClass: scopeRecords[0]?.assetClass ?? null,
        style: scopeRecords[0]?.style ?? null,
        setupFamily: null,
        regimeTag: null,
        provider: null,
        providerHealthState: null,
      }),
    },
    {
      scopeType: "SETUP_STYLE",
      group: (record: CalibrationOutcomeRecord) => `${record.setupFamily ?? "Unknown"}:${record.style}`,
      shape: (scopeRecords: CalibrationOutcomeRecord[]) => ({
        symbol: null,
        assetClass: scopeRecords[0]?.assetClass ?? null,
        style: scopeRecords[0]?.style ?? null,
        setupFamily: scopeRecords[0]?.setupFamily ?? null,
        regimeTag: null,
        provider: null,
        providerHealthState: null,
      }),
    },
    {
      scopeType: "REGIME_STYLE",
      group: (record: CalibrationOutcomeRecord) => `${record.regimeTag ?? "unclear"}:${record.style}`,
      shape: (scopeRecords: CalibrationOutcomeRecord[]) => ({
        symbol: null,
        assetClass: scopeRecords[0]?.assetClass ?? null,
        style: scopeRecords[0]?.style ?? null,
        setupFamily: null,
        regimeTag: scopeRecords[0]?.regimeTag ?? null,
        provider: null,
        providerHealthState: null,
      }),
    },
    {
      scopeType: "PROVIDER_STYLE",
      group: (record: CalibrationOutcomeRecord) => `${record.provider ?? "unknown"}:${record.style}`,
      shape: (scopeRecords: CalibrationOutcomeRecord[]) => ({
        symbol: null,
        assetClass: scopeRecords[0]?.assetClass ?? null,
        style: scopeRecords[0]?.style ?? null,
        setupFamily: null,
        regimeTag: null,
        provider: scopeRecords[0]?.provider ?? null,
        providerHealthState: scopeRecords[0]?.providerHealthState ?? null,
      }),
    },
  ];

  return scopes.flatMap(scope => {
    const grouped = groupBy(records, scope.group);
    return Array.from(grouped.values()).map(scopeRecords => ({
      scopeType: scope.scopeType,
      ...scope.shape(scopeRecords),
      sampleSize: scopeRecords.length,
      winRate: round(winRate(scopeRecords)),
      averageRR: round(averageRR(scopeRecords)),
      expectancy: round(expectancy(scopeRecords)),
      maxDrawdown: round(maxDrawdown(scopeRecords)),
      confidenceMean: round(meanConfidence(scopeRecords)),
    }));
  });
}

export function buildEvidenceGateRules(
  records: CalibrationOutcomeRecord[],
  input?: {
    minimumSampleSize?: number;
    minimumWinRate?: number;
    minimumExpectancy?: number;
  }
): EvidenceGateRule[] {
  const minimumSampleSize = Math.max(3, input?.minimumSampleSize ?? 8);
  const minimumWinRate = input?.minimumWinRate ?? 0.4;
  const minimumExpectancy = input?.minimumExpectancy ?? 0;
  const windows = buildStrategyPerformanceWindows(records);

  return windows
    .filter(window => window.scopeType !== "GLOBAL")
    .filter(window => window.sampleSize >= minimumSampleSize)
    .filter(window =>
      (window.winRate != null && window.winRate < minimumWinRate) ||
      (window.expectancy != null && window.expectancy < minimumExpectancy)
    )
    .map(window => {
      const key = makeScopeKey(window.scopeType, {
        symbol: window.symbol,
        style: window.style,
        setupFamily: window.setupFamily,
        regimeTag: window.regimeTag,
        provider: window.provider,
      });
      const reasonParts = [
        window.winRate != null && window.winRate < minimumWinRate
          ? `win rate ${Math.round(window.winRate * 100)}% < ${Math.round(minimumWinRate * 100)}%`
          : null,
        window.expectancy != null && window.expectancy < minimumExpectancy
          ? `expectancy ${window.expectancy.toFixed(2)}R < ${minimumExpectancy.toFixed(2)}R`
          : null,
      ].filter(Boolean);

      return {
        scopeType: window.scopeType,
        key,
        label: key,
        symbol: window.symbol,
        style: window.style,
        setupFamily: window.setupFamily,
        regimeTag: window.regimeTag,
        provider: window.provider,
        sampleSize: window.sampleSize,
        winRate: window.winRate,
        averageRR: window.averageRR,
        expectancy: window.expectancy,
        reason: reasonParts.join(" and "),
      };
    });
}
