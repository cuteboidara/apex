import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { closePaperPosition, markPaperPosition, openPaperPositionFromTradePlan, listPaperAccounts } from "@/lib/execution/paperBroker";

export const dynamic = "force-dynamic";

type ExecutionPositionsRouteDependencies = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  prisma: typeof prisma;
  listPaperAccounts: typeof listPaperAccounts;
  openPaperPositionFromTradePlan: typeof openPaperPositionFromTradePlan;
  markPaperPosition: typeof markPaperPosition;
  closePaperPosition: typeof closePaperPosition;
  recordAuditEvent: typeof recordAuditEvent;
};

export function createExecutionPositionsRouteHandlers(deps: ExecutionPositionsRouteDependencies) {
  return {
    GET: async (req: NextRequest) => {
      try {
        const session = await deps.getSession();
        const ownerUserId = session?.user ? ((session.user as { id?: string }).id ?? null) : null;
        const { searchParams } = new URL(req.url);
        const status = searchParams.get("status");
        const accounts = await deps.listPaperAccounts(ownerUserId);

        const positions = await deps.prisma.paperPosition.findMany({
          where: {
            accountId: { in: accounts.map(account => account.id) },
            ...(status ? { status } : {}),
          },
          orderBy: { openedAt: "desc" },
          take: 100,
        });

        return NextResponse.json({ positions });
      } catch (error) {
        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to load paper trading positions.",
        });
      }
    },

    POST: async (req: NextRequest) => {
      try {
        const session = await deps.getSession();
        const ownerUserId = session?.user ? ((session.user as { id?: string }).id ?? null) : null;
        const actorId = ownerUserId ?? "anonymous";
        const body = await req.json().catch(() => null) as
          | {
              action?: "execute_trade_plan" | "mark_to_market" | "close_position";
              tradePlanId?: string;
              accountId?: string | null;
              positionId?: string;
              quantity?: number | null;
              riskFraction?: number;
              spreadBps?: number;
              slippageBps?: number;
              currentPrice?: number;
              exitPrice?: number;
            }
          | null;

        if (!body?.action) {
          return NextResponse.json({
            error: "Missing action",
            code: "BAD_REQUEST",
            details: "Execution requests require an action value.",
            likelyMigrationIssue: false,
            hint: null,
          }, { status: 400 });
        }

        if (body.action === "execute_trade_plan" && body.tradePlanId) {
          const result = await deps.openPaperPositionFromTradePlan({
            tradePlanId: body.tradePlanId,
            ownerUserId,
            accountId: body.accountId ?? null,
            quantity: body.quantity ?? null,
            riskFraction: body.riskFraction,
            spreadBps: body.spreadBps,
            slippageBps: body.slippageBps,
          });
          await deps.recordAuditEvent({
            actor: actorId,
            action: "paper_trade_executed",
            entityType: "PaperPosition",
            entityId: result.position.id,
            after: {
              tradePlanId: body.tradePlanId,
              accountId: result.accountId,
            },
          });
          return NextResponse.json(result);
        }

        if (body.action === "mark_to_market" && body.positionId && typeof body.currentPrice === "number") {
          const position = await deps.markPaperPosition({
            positionId: body.positionId,
            currentPrice: body.currentPrice,
          });
          await deps.recordAuditEvent({
            actor: actorId,
            action: "paper_position_marked",
            entityType: "PaperPosition",
            entityId: position.id,
            after: {
              currentPrice: body.currentPrice,
              unrealizedPnl: position.unrealizedPnl,
            },
          });
          return NextResponse.json({ position });
        }

        if (body.action === "close_position" && body.positionId && typeof body.exitPrice === "number") {
          const position = await deps.closePaperPosition({
            positionId: body.positionId,
            exitPrice: body.exitPrice,
            spreadBps: body.spreadBps,
            slippageBps: body.slippageBps,
          });
          await deps.recordAuditEvent({
            actor: actorId,
            action: "paper_position_closed",
            entityType: "PaperPosition",
            entityId: position.id,
            after: {
              exitPrice: body.exitPrice,
              realizedPnl: position.realizedPnl,
            },
          });
          return NextResponse.json({ position });
        }

        return NextResponse.json({
          error: "Unsupported execution action or missing parameters",
          code: "BAD_REQUEST",
          details: "Provide the required identifiers and prices for the requested execution action.",
          likelyMigrationIssue: false,
          hint: null,
        }, { status: 400 });
      } catch (error) {
        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to process the paper trading action.",
          fallbackStatus: 400,
        });
      }
    },
  };
}

const executionPositionsRouteHandlers = createExecutionPositionsRouteHandlers({
  getSession: () => getServerSession(authOptions),
  prisma,
  listPaperAccounts,
  openPaperPositionFromTradePlan,
  markPaperPosition,
  closePaperPosition,
  recordAuditEvent,
});

export const GET = executionPositionsRouteHandlers.GET;
export const POST = executionPositionsRouteHandlers.POST;
