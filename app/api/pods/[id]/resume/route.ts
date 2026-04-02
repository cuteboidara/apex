import { NextResponse } from "next/server";

import { resumePodPayload } from "@/src/presentation/api/pods";

export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    return NextResponse.json(await resumePodPayload(params.id));
  } catch (error) {
    console.error("[pod-resume-route] Failed to resume pod:", error);
    return NextResponse.json({ error: "pod_resume_failed" }, { status: 500 });
  }
}
