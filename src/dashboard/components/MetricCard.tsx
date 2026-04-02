export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const valueClass = tone === "good"
    ? "text-[var(--apex-status-active-text)]"
    : tone === "warn"
      ? "text-[var(--apex-status-watchlist-text)]"
      : tone === "bad"
        ? "text-[var(--apex-status-blocked-text)]"
        : "text-[var(--apex-text-primary)]";

  return (
    <section className="apex-surface apex-fade-in px-6 py-5">
      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">{label}</p>
      <p className={`mt-3 font-[var(--apex-font-mono)] text-[48px] font-normal leading-none ${valueClass}`}>{value}</p>
      {detail ? <p className="mt-3 max-w-[180px] text-[12px] text-[var(--apex-text-tertiary)]">{detail}</p> : null}
    </section>
  );
}
