import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/infrastructure/auth/auth";
import { recordAuditEvent } from "@/lib/audit";
import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { getOrCreatePaperAccount, listPaperAccounts } from "@/lib/execution/paperBroker";

export const dynamic = "force-dynamic";

type ExecutionAccountsRouteDependencies = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  listPaperAccounts: typeof listPaperAccounts;
  getOrCreatePaperAccount: typeof getOrCreatePaperAccount;
  recordAuditEvent: typeof recordAuditEvent;
};

export function createExecutionAccountsRouteHandlers(deps: ExecutionAccountsRouteDependencies) {
  return {
    GET: async () => {
      try {
        const session = await deps.getSession();
        const ownerUserId = session?.user ? ((session.user as { id?: string }).id ?? null) : null;
        const accounts = await deps.listPaperAccounts(ownerUserId);
        return NextResponse.json({ accounts });
      } catch (error) {
        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to load paper trading accounts.",
        });
      }
    },

    POST: async (req: NextRequest) => {
      try {
        const session = await deps.getSession();
        const body = await req.json().catch(() => null) as { name?: string } | null;
        const ownerUserId = session?.user ? ((session.user as { id?: string }).id ?? null) : null;
        const account = await deps.getOrCreatePaperAccount({
          ownerUserId,
          name: body?.name,
        });
        await deps.recordAuditEvent({
          actor: ownerUserId ?? "anonymous",
          action: "paper_account_accessed",
          entityType: "PaperAccount",
          entityId: account.id,
          after: {
            name: account.name,
            isDefault: account.isDefault,
          },
        });
        return NextResponse.json({ account });
      } catch (error) {
        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to create or load a paper trading account.",
        });
      }
    },
  };
}

const executionAccountsRouteHandlers = createExecutionAccountsRouteHandlers({
  getSession: () => getServerSession(authOptions),
  listPaperAccounts,
  getOrCreatePaperAccount,
  recordAuditEvent,
});

export const GET = executionAccountsRouteHandlers.GET;
export const POST = executionAccountsRouteHandlers.POST;
