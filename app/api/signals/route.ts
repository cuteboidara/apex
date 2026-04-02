import { NextResponse } from "next/server";

import { createEmptySignalsPayload, getSignalsPayload } from "@/src/presentation/api/signals";
import { RepositoryUnavailableError } from "@/src/lib/repository";
import { logger } from "@/src/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSignalsPayload());
  } catch (error) {
    if (error instanceof RepositoryUnavailableError) {
      return NextResponse.json(createEmptySignalsPayload());
    }
    logger.error({
      module: "signals-route",
      message: "Failed to serve canonical signals payload",
      error: String(error),
    });
    return NextResponse.json(
      {
        error: "canonical_truth_missing",
      },
      { status: 503 },
    );
  }
}
