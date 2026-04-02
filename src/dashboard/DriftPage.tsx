import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getDriftPageData } from "@/src/dashboard/data";

export async function DriftPage() {
  const { drift, models, mode } = await getDriftPageData();

  return (
    <ApexShell
      title="Drift & Learning"
      subtitle="Slow-path supervision for calibration drift, feature distribution shift, shadow retrain requests, and governed model registry progression."
      mode={mode}
    >
      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <DataPanel title="Current Drift Status" eyebrow="Per Pod">
          <div className="space-y-3">
            {drift.map(row => (
              <div key={row.pod_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pod_id}</p>
                  <StatusBadge
                    label={row.drift_flags.length ? row.drift_flags.join(" / ") : "green"}
                    tone={row.drift_flags.length > 1 ? "bad" : row.drift_flags.length === 1 ? "warn" : "good"}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">
                  <p>Accuracy 7d: {(row.prediction_accuracy_7d * 100).toFixed(1)}%</p>
                  <p>Accuracy 30d: {(row.prediction_accuracy_30d * 100).toFixed(1)}%</p>
                  <p>Calibration Error: {(row.confidence_calibration_error * 100).toFixed(1)}%</p>
                  <p>Feature Shift: {(row.feature_distribution_shift * 100).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Model Registry" eyebrow="Promotion Pipeline">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Pod</th>
                  <th className="py-2 pr-4">Version</th>
                  <th className="py-2 pr-4">Stage</th>
                  <th className="py-2">Validation</th>
                </tr>
              </thead>
              <tbody>
                {models.map(model => (
                  <tr key={`${model.pod_id}-${model.version}`}>
                    <td className="py-3 pr-4 apex-table-highlight">{model.pod_id}</td>
                    <td className="py-3 pr-4">{model.version}</td>
                    <td className="py-3 pr-4">{model.deployment_status}</td>
                    <td className="py-3">{model.validation_score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </section>
    </ApexShell>
  );
}
