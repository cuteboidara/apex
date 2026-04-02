import { NextResponse } from "next/server";

import { getPodDetailsPayload } from "@/src/presentation/api/pods";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  try {
    return NextResponse.json(await getPodDetailsPayload(params.id));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("pod_not_found:")) {
      return NextResponse.json(
        {
          error: "Pod not found.",
        },
        { status: 404 },
      );
    }

    console.error("[pod-detail-route] Failed to serve pod details:", error);
    return NextResponse.json(
      {
        error: "Pod details unavailable.",
      },
      { status: 503 },
    );
  }
}
