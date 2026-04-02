import type { PodDashboardRow, PodDetailsPayload } from "@/src/dashboard/types";
import { getApexRuntime } from "@/src/lib/runtime";

export async function getPodsPayload() {
  const runtime = getApexRuntime();
  const latestOutputs = runtime.repository.getLatestPodOutputs();
  const driftByPod = new Map(runtime.repository.getCurrentDriftStatus().map(row => [row.pod_id, row]));

  return runtime.pods.map(pod => {
    const recentOutputs = runtime.repository.getPodOutputHistory({
      pod_id: pod.pod_id,
      limit: 8,
    });
    const lastOutput = latestOutputs.find(output => output.pod_id === pod.pod_id) ?? null;
    const drift = driftByPod.get(pod.pod_id);
    return {
      pod_id: pod.pod_id,
      model_version: pod.model_version,
      pod_category: pod.pod_category,
      status: pod.getStatus(),
      diagnostics: pod.getDiagnostics(),
      last_output: lastOutput,
      last_updated: lastOutput?.ts ?? null,
      confidence_trend: [...recentOutputs].reverse().map(output => output.confidence),
      drift_flags: drift?.drift_flags ?? [],
      recommended_update_scope: drift?.recommended_update_scope ?? "none",
      diagnostics_url: `/api/pods/${pod.pod_id}`,
    } satisfies PodDashboardRow;
  });
}

export async function getPodDetailsPayload(id: string) {
  const runtime = getApexRuntime();
  const pod = runtime.pods.find(item => item.pod_id === id);
  if (!pod) {
    throw new Error(`pod_not_found:${id}`);
  }

  const [base] = await Promise.all([
    getPodsPayload().then(rows => rows.find(row => row.pod_id === id)),
  ]);

  if (!base) {
    throw new Error(`pod_not_found:${id}`);
  }

  return {
    ...base,
    recent_outputs: runtime.repository.getPodOutputHistory({
      pod_id: id,
      limit: 20,
    }),
    model_registry: runtime.repository.getModelRegistry().filter(model => model.pod_id === id),
  } satisfies PodDetailsPayload;
}

export async function pausePodPayload(id: string) {
  const runtime = getApexRuntime();
  const pod = runtime.pods.find(item => item.pod_id === id);
  if (!pod) {
    throw new Error(`pod_not_found:${id}`);
  }
  pod.pause();
  await runtime.repository.appendSystemEvent({
    event_id: `pause_${Date.now()}_${id}`,
    ts: Date.now(),
    module: "pods",
    type: "pod_paused",
    reason: "operator action",
    payload: { pod_id: id },
  });
  return { pod_id: id, status: pod.getStatus() };
}

export async function resumePodPayload(id: string) {
  const runtime = getApexRuntime();
  const pod = runtime.pods.find(item => item.pod_id === id);
  if (!pod) {
    throw new Error(`pod_not_found:${id}`);
  }
  pod.resume();
  await runtime.repository.appendSystemEvent({
    event_id: `resume_${Date.now()}_${id}`,
    ts: Date.now(),
    module: "pods",
    type: "pod_resumed",
    reason: "operator action",
    payload: { pod_id: id },
  });
  return { pod_id: id, status: pod.getStatus() };
}
