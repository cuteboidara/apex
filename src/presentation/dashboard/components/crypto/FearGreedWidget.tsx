"use client";

type FearGreedPayload = {
  value: number | null;
  label: string | null;
  timestamp: string | null;
};

function fearTone(value: number | null): string {
  if (value == null) return "#94A3B8";
  if (value <= 24) return "#F87171";
  if (value <= 44) return "#FB923C";
  if (value <= 55) return "#94A3B8";
  if (value <= 74) return "#A3E635";
  return "#4ADE80";
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 180) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function arcPath(value: number) {
  const clamped = Math.max(0, Math.min(100, value));
  const start = polarToCartesian(60, 60, 42, 0);
  const end = polarToCartesian(60, 60, 42, (clamped / 100) * 180);
  const largeArc = clamped > 50 ? 1 : 0;
  return `M ${start.x} ${start.y} A 42 42 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function FearGreedWidget({ sentiment, error }: { sentiment: FearGreedPayload | null; error: string | null }) {
  const value = sentiment?.value ?? null;
  const tone = fearTone(value);

  return (
    <section className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Fear &amp; Greed
          </p>
          <p className="mt-2 text-[14px] text-[var(--apex-text-secondary)]">
            Crypto sentiment gauge
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-5 text-[13px] text-[var(--apex-text-secondary)]">
          Sentiment data unavailable
        </p>
      ) : (
        <div className="mt-5 flex items-center gap-5">
          <svg viewBox="0 0 120 70" className="h-28 w-40 shrink-0">
            <path
              d="M 18 60 A 42 42 0 0 1 102 60"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            {value != null ? (
              <path
                d={arcPath(value)}
                fill="none"
                stroke={tone}
                strokeWidth="10"
                strokeLinecap="round"
              />
            ) : null}
          </svg>
          <div>
            <p className="font-[var(--apex-font-mono)] text-[34px] leading-none text-[var(--apex-text-primary)]">
              {value != null ? value : "—"}
            </p>
            <p className="mt-2 text-[15px]" style={{ color: tone }}>
              {sentiment?.label ?? "Unavailable"}
            </p>
            <p className="mt-3 text-[12px] text-[var(--apex-text-tertiary)]">
              {sentiment?.timestamp ? `Updated ${new Date(sentiment.timestamp).toLocaleString()}` : "Awaiting feed"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
