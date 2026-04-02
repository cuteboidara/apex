import type { ReactNode } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { ApexSidebar } from "@/src/dashboard/components/ApexSidebar";
import type { RecoveryMode } from "@/src/interfaces/contracts";

export function ApexShell({
  title,
  subtitle,
  mode,
  children,
}: {
  title: string;
  subtitle: string;
  mode: RecoveryMode;
  children: ReactNode;
}) {
  const modeVariant = mode === "normal" ? "active" : mode === "full_stop" ? "blocked" : "watchlist";

  return (
    <div className="apex-shell md:flex md:min-h-screen">
      <ApexSidebar mode={mode} />
      <main className="apex-main-region min-w-0 flex-1 overflow-x-hidden px-5 pb-12 pt-20 md:px-10 md:pb-14 md:pt-10 xl:px-12">
        <header className="apex-page-header">
          <div>
            <h1 className="apex-page-title">{title}</h1>
            <p className="apex-page-subtitle">{subtitle}</p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <Chip label={mode.replaceAll("_", " ")} variant={modeVariant} />
            <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">
              Governance-First Runtime
            </p>
          </div>
        </header>
        <div className="space-y-8">{children}</div>
      </main>
    </div>
  );
}
