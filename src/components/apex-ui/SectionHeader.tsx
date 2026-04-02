export function SectionHeader({
  title,
  count,
  subtitle,
  className = "",
}: {
  title: string;
  count?: number;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={`mb-6 border-b border-[var(--apex-border-subtle)] pb-4 ${className}`.trim()}>
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="m-0 font-[var(--apex-font-body)] text-[16px] font-semibold leading-none tracking-[-0.01em] text-[var(--apex-text-primary)]">
          {title}
        </h2>
        {typeof count === "number" ? (
          <span className="text-[13px] font-normal text-[var(--apex-text-tertiary)]">
            {count}
          </span>
        ) : null}
      </div>
      {subtitle ? <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">{subtitle}</p> : null}
    </div>
  );
}
