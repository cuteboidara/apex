import { NextResponse } from "next/server";

import { pausePodPayload } from "@/src/presentation/api/pods";

export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    return NextResponse.json(await pausePodPayload(params.id));
  } catch (error) {
    console.error("[pod-pause-route] Failed to pause pod:", error);
    return NextResponse.json({ error: "pod_pause_failed" }, { status: 500 });
  }
}
