function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function MeterBar({
  label,
  value,
  valueLabel,
  tone = "neutral",
}: {
  label: string;
  value: number;
  valueLabel?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const percent = clampPercent(value);
  const fillClass = tone === "good"
    ? "bg-[var(--apex-status-active-text)]"
    : tone === "warn"
      ? "bg-[var(--apex-text-accent)]"
      : tone === "bad"
        ? "bg-[var(--apex-status-blocked-text)]"
        : "bg-[var(--apex-text-secondary)]";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">{label}</span>
        <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{valueLabel ?? `${percent.toFixed(1)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-base)]">
        <div className={`h-full ${fillClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
