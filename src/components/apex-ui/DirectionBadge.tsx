type Direction = "buy" | "sell" | "neutral" | "long" | "short";

function directionTone(direction: Direction) {
  if (direction === "buy" || direction === "long") {
    return {
      label: "LONG",
      className: "text-[var(--apex-bull)]",
      path: "M6 2 10 10H2L6 2Z",
    };
  }

  if (direction === "sell" || direction === "short") {
    return {
      label: "SHORT",
      className: "text-[var(--apex-bear)]",
      path: "M6 10 2 2h8L6 10Z",
    };
  }

  return {
    label: "NEUTRAL",
    className: "text-[var(--apex-neutral)]",
    path: "",
  };
}

export function DirectionBadge({
  direction,
  className = "",
}: {
  direction: Direction;
  className?: string;
}) {
  const tone = directionTone(direction);

  return (
    <span className={`inline-flex items-center gap-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.08em] ${tone.className} ${className}`.trim()}>
      {tone.path ? (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
          <path d={tone.path} />
        </svg>
      ) : (
        <span aria-hidden="true">-</span>
      )}
      <span>{tone.label}</span>
    </span>
  );
}
