import { NextResponse } from "next/server";

import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { applyManualOutcomeEntry } from "@/src/application/outcomes/manualEntryService";

export const dynamic = "force-dynamic";

type ManualOutcomeActionBody = {
  action?: string;
  tradePlanId?: string | null;
  signalId?: string | null;
  outcome?: "INVALIDATED" | "STOP" | "STOP_AFTER_TP1" | "STOP_AFTER_TP2" | "TP1" | "TP2" | "TP3" | "EXPIRED";
  realizedRR?: number | null;
  note?: string | null;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => null) as ManualOutcomeActionBody | null;
    if (body?.action !== "manual_outcome_entry") {
      return NextResponse.json({
        ok: false,
        error: "unsupported_action",
      }, { status: 400 });
    }

    if (!body.tradePlanId && !body.signalId) {
      return NextResponse.json({
        ok: false,
        error: "manual_outcome_requires_tradeplan_or_signal",
      }, { status: 400 });
    }

    if (!body.outcome) {
      return NextResponse.json({
        ok: false,
        error: "manual_outcome_requires_outcome",
      }, { status: 400 });
    }

    const outcome = await applyManualOutcomeEntry({
      tradePlanId: body.tradePlanId ?? null,
      signalId: body.signalId ?? null,
      outcome: body.outcome,
      realizedRR: typeof body.realizedRR === "number" && Number.isFinite(body.realizedRR) ? body.realizedRR : null,
      note: body.note ?? null,
    });

    return NextResponse.json({
      ok: true,
      ...outcome,
    });
  } catch (error) {
    return buildRouteErrorResponse(error, {
      publicMessage: "Manual validation outcome",
    });
  }
}
