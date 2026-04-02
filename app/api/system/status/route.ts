import { NextResponse } from "next/server";

import { createDegradedSystemStatusPayload, getSystemStatusPayload } from "@/src/presentation/api/system";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
const ROUTE_TIMEOUT_MS = 10_000;

export async function GET() {
  try {
    const payload = await Promise.race([
      getSystemStatusPayload(),
      new Promise<ReturnType<typeof createDegradedSystemStatusPayload>>(resolve => {
        setTimeout(() => resolve(createDegradedSystemStatusPayload("System status timeout")), ROUTE_TIMEOUT_MS);
      }),
    ]);

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[system-status-route] Failed to serve system status:", error);
    return NextResponse.json(createDegradedSystemStatusPayload("System status partially unavailable"));
  }
}
