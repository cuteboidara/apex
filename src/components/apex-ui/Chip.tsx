type ChipVariant = "active" | "watchlist" | "blocked" | "developing" | "neutral";

const VARIANT_STYLES: Record<ChipVariant, React.CSSProperties> = {
  active: {
    background: "var(--apex-status-active-bg)",
    border: "1px solid var(--apex-status-active-border)",
    color: "var(--apex-status-active-text)",
  },
  watchlist: {
    background: "var(--apex-status-watchlist-bg)",
    border: "1px solid var(--apex-status-watchlist-border)",
    color: "var(--apex-status-watchlist-text)",
  },
  blocked: {
    background: "var(--apex-status-blocked-bg)",
    border: "1px solid var(--apex-status-blocked-border)",
    color: "var(--apex-status-blocked-text)",
  },
  developing: {
    background: "var(--apex-status-developing-bg)",
    border: "1px solid var(--apex-status-developing-border)",
    color: "var(--apex-status-developing-text)",
  },
  neutral: {
    background: "rgba(113, 113, 122, 0.15)",
    border: "1px solid rgba(113, 113, 122, 0.20)",
    color: "var(--apex-text-secondary)",
  },
};

export function Chip({
  label,
  variant,
  className = "",
}: {
  label: string;
  variant: ChipVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center font-[var(--apex-font-mono)] uppercase ${className}`.trim()}
      style={{
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderRadius: "999px",
        display: "inline-flex",
        fontSize: "9px",
        letterSpacing: "0.1em",
        padding: "5px 10px",
        textTransform: "uppercase",
        ...VARIANT_STYLES[variant],
      }}
    >
      {label}
    </span>
  );
}
