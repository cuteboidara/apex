export function ConfidenceTrend({
  values,
}: {
  values: number[];
}) {
  if (values.length === 0) {
    return <p className="text-xs text-[var(--apex-text-tertiary)]">No confidence history yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex h-14 items-end gap-1">
        {values.map((value, index) => (
          <div
            key={`${index}-${value.toFixed(4)}`}
            className="flex-1 rounded-t-[var(--apex-radius-sm)] bg-[linear-gradient(180deg,var(--apex-amber),var(--apex-status-active-text))]"
            style={{ height: `${Math.max(12, value * 100)}%` }}
            title={`${Math.round(value * 100)}%`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">
        <span>{Math.round(values[0] * 100)}%</span>
        <span>{Math.round(values[values.length - 1] * 100)}%</span>
      </div>
    </div>
  );
}
