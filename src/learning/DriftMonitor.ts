import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import type { ApexRepository } from "@/src/lib/repository";
import type { DriftMetrics, IAlphaPod, ModelDeploymentStage, ModelRegistryRecord } from "@/src/interfaces/contracts";

const STAGE_ORDER: ModelDeploymentStage[] = [
  "research",
  "candidate",
  "shadow",
  "limited",
  "production",
  "deprecated",
  "retired",
];

export class DriftMonitor {
  constructor(
    private readonly repository: ApexRepository,
    private readonly getPods: () => IAlphaPod[],
  ) {}

  private computeMetrics(podId: string): DriftMetrics {
    const feedback = this.repository
      .getDecisionJournal(200)
      .filter(entry => entry.pod_output_refs.some(ref => ref.includes(podId)));
    const sample = Math.max(1, feedback.length);
    const prediction7d = Math.max(0.3, 0.7 - sample * 0.001);
    const prediction30d = Math.max(0.35, 0.72 - sample * 0.0005);
    const calibrationError = Math.min(1, Math.abs(prediction7d - prediction30d) * 1.2);
    const featureShift = Math.min(1, this.repository.getLatestPodOutputs().filter(output => output.pod_id === podId).length * 0.0025);
    const flags = [
      calibrationError > 0.12 ? "confidence_calibration_error" : null,
      featureShift > 0.2 ? "feature_distribution_shift" : null,
      prediction7d + 0.1 < prediction30d ? "accuracy_decay" : null,
    ].filter((value): value is string => Boolean(value));

    return {
      pod_id: podId,
      ts: Date.now(),
      prediction_accuracy_7d: prediction7d,
      prediction_accuracy_30d: prediction30d,
      confidence_calibration_error: calibrationError,
      feature_distribution_shift: featureShift,
      drift_flags: flags,
      recommended_update_scope: flags.includes("accuracy_decay")
        ? "shadow_retrain"
        : flags.length > 0
          ? "confidence_recalibration"
          : "none",
    };
  }

  async reducePodConfidence(podId: string, factor: number): Promise<void> {
    this.repository.setConfidenceMultiplier(podId, factor);
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "learning",
      type: "pod_confidence_reduced",
      reason: "drift response",
      payload: { podId, factor },
    });
  }

  async pausePod(podId: string, reason: string): Promise<void> {
    const pod = this.getPods().find(item => item.pod_id === podId);
    pod?.pause();
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "learning",
      type: "pod_paused",
      reason,
      payload: { podId },
    });
  }

  async flagForShadowRetrain(podId: string): Promise<void> {
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "learning",
      type: "shadow_retrain_requested",
      reason: "drift threshold exceeded",
      payload: { podId },
    });
  }

  async revertModel(podId: string, version: string): Promise<void> {
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "learning",
      type: "revert_candidate_requested",
      reason: "manual revert request staged; live model replacement is blocked by governance",
      payload: { podId, version },
    });
  }

  validatePromotionTransition(from: ModelDeploymentStage, to: ModelDeploymentStage): boolean {
    return STAGE_ORDER.indexOf(to) - STAGE_ORDER.indexOf(from) <= 1;
  }

  async registerModel(record: ModelRegistryRecord): Promise<void> {
    const latest = this.repository
      .getModelRegistry()
      .find(item => item.pod_id === record.pod_id);
    if (latest && !this.validatePromotionTransition(latest.deployment_status, record.deployment_status)) {
      throw new Error(`stage_skip_blocked:${latest.deployment_status}->${record.deployment_status}`);
    }

    await this.repository.appendModelRegistry(record);
  }

  async run(): Promise<DriftMetrics[]> {
    const outputs: DriftMetrics[] = [];
    for (const pod of this.getPods()) {
      const metrics = this.computeMetrics(pod.pod_id);
      outputs.push(metrics);
      await this.repository.appendDriftLog(metrics);

      if (metrics.recommended_update_scope === "confidence_recalibration") {
        await this.reducePodConfidence(pod.pod_id, 0.8);
      }
      if (metrics.recommended_update_scope === "shadow_retrain") {
        await this.flagForShadowRetrain(pod.pod_id);
      }
      if (metrics.drift_flags.includes("feature_distribution_shift")) {
        await this.pausePod(pod.pod_id, "feature distribution shift beyond threshold");
      }
    }

    logger.info({
      module: "learning",
      message: "Drift cycle completed",
      pod_count: outputs.length,
    });
    return outputs;
  }
}
