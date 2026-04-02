import Link from "next/link";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { ConfidenceTrend } from "@/src/dashboard/components/ConfidenceTrend";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { PodToggleButton } from "@/src/dashboard/components/PodToggleButton";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getPodsPageData, getSystemStatusData } from "@/src/dashboard/data";

export async function PodsPage() {
  const [pods, status] = await Promise.all([
    getPodsPageData(),
    getSystemStatusData(),
  ]);

  return (
    <ApexShell
      title="Pod Management"
      subtitle="Operational card wall for alpha pod state, last signal, confidence posture, drift pressure, and governed operator controls."
      mode={status.mode}
    >
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {pods.map(pod => (
          <DataPanel key={pod.pod_id} title={pod.pod_id} eyebrow={`${pod.pod_category} • Model ${pod.model_version}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge
                  label={pod.status}
                  tone={pod.status === "active" ? "good" : pod.status === "paused" ? "warn" : "bad"}
                />
                <StatusBadge
                  label={pod.drift_flags.length ? pod.drift_flags.join(" / ") : "stable"}
                  tone={pod.drift_flags.length > 1 ? "bad" : pod.drift_flags.length === 1 ? "warn" : "good"}
                />
              </div>

              <div className="grid gap-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Last signal</span>
                  <span>
                    {pod.last_output?.pod_category === "directional"
                      ? pod.last_output.direction
                      : pod.last_output?.pod_category === "gating"
                        ? pod.last_output.gate_status
                        : "n/a"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Last confidence</span>
                  <span>{pod.last_output ? `${Math.round(pod.last_output.confidence * 100)}%` : "n/a"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Entry style</span>
                  <span>{pod.last_output?.entry_style ?? "n/a"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Updated</span>
                  <span>{pod.last_updated ? new Date(pod.last_updated).toLocaleTimeString() : "n/a"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Learning posture</span>
                  <span>{pod.recommended_update_scope.replaceAll("_", " ")}</span>
                </div>
              </div>

              <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3">
                <p className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Confidence Trend</p>
                <ConfidenceTrend values={pod.confidence_trend} />
              </div>

              <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3">
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Diagnostics</p>
                <p className="mt-2 text-xs text-[var(--apex-text-tertiary)]">{Object.keys(pod.diagnostics).length} diagnostic fields exposed.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <PodToggleButton podId={pod.pod_id} active={pod.status === "active"} />
                  <Link
                    href={pod.diagnostics_url}
                    target="_blank"
                    className="apex-link-button"
                  >
                    Open Diagnostics
                  </Link>
                </div>
              </div>
            </div>
          </DataPanel>
        ))}
      </div>
      {pods.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No pods registered in the runtime.</p> : null}
    </ApexShell>
  );
}
