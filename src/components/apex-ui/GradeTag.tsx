import type { TraderSignalGrade } from "@/src/lib/traderContracts";

const GRADE_CLASS: Record<TraderSignalGrade, string> = {
  "S+": "text-[var(--apex-grade-s-plus)]",
  S: "text-[var(--apex-grade-s)]",
  A: "text-[var(--apex-grade-a)]",
  B: "text-[var(--apex-grade-b)]",
  C: "text-[var(--apex-grade-c)]",
  D: "text-[var(--apex-grade-d)]",
  F: "text-[var(--apex-grade-f)]",
};

export function GradeTag({
  grade,
  className = "",
}: {
  grade: string;
  className?: string;
}) {
  const tone = GRADE_CLASS[grade as TraderSignalGrade] ?? "text-[var(--apex-text-tertiary)]";

  return (
    <span className={`font-[var(--apex-font-mono)] text-[16px] font-semibold leading-none ${tone} ${className}`.trim()}>
      {grade}
    </span>
  );
}
