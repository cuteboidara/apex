import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { recordAuditEvent } from "@/lib/audit";
import { ADMIN_EMAIL } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

type AdminUserRouteDependencies = {
  prisma: typeof prisma;
  requireAdmin: typeof requireAdmin;
  recordAuditEvent: typeof recordAuditEvent;
  adminEmail: string;
};

export function createAdminUserRouteHandlers(deps: AdminUserRouteDependencies) {
  return {
    GET: async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const auth = await deps.requireAdmin();
      if (!auth.ok) return auth.response;

      const { id } = await params;
      const user = await deps.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          approvedAt: true,
          approvedBy: true,
          suspendedReason: true,
          lastLoginAt: true,
          loginCount: true,
          createdAt: true,
        },
      });

      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
      return NextResponse.json(user);
    },

    PATCH: async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const auth = await deps.requireAdmin();
      if (!auth.ok) return auth.response;

      const { id } = await params;
      const body = await req.json() as {
        action: "approve" | "suspend" | "ban" | "restore" | "unban";
        reason?: string;
      };

      const user = await deps.prisma.user.findUnique({ where: { id } });
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

      let data: Record<string, unknown> = {};

      switch (body.action) {
        case "approve":
          data = { status: "APPROVED", approvedAt: new Date(), approvedBy: deps.adminEmail, suspendedReason: null };
          break;
        case "suspend":
          data = { status: "SUSPENDED", suspendedReason: body.reason ?? null };
          break;
        case "ban":
          data = { status: "BANNED" };
          break;
        case "restore":
          data = { status: "APPROVED", suspendedReason: null };
          break;
        case "unban":
          data = { status: "APPROVED" };
          break;
        default:
          return NextResponse.json({ error: "Invalid action" }, { status: 400 });
      }

      const updated = await deps.prisma.user.update({ where: { id }, data });
      await deps.recordAuditEvent({
        actor: "ADMIN",
        action: `user_${body.action}`,
        entityType: "User",
        entityId: user.id,
        before: {
          status: user.status,
          suspendedReason: user.suspendedReason,
        },
        after: {
          status: updated.status,
          suspendedReason: updated.suspendedReason,
        },
      });
      return NextResponse.json({ success: true, status: updated.status });
    },

    DELETE: async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const auth = await deps.requireAdmin();
      if (!auth.ok) return auth.response;

      const { id } = await params;
      const existing = await deps.prisma.user.findUnique({ where: { id } });
      await deps.prisma.user.delete({ where: { id } });
      await deps.recordAuditEvent({
        actor: "ADMIN",
        action: "user_deleted",
        entityType: "User",
        entityId: id,
        before: existing ? {
          email: existing.email,
          status: existing.status,
        } : null,
      });
      return NextResponse.json({ success: true });
    },
  };
}

const adminUserRouteHandlers = createAdminUserRouteHandlers({
  prisma,
  requireAdmin,
  recordAuditEvent,
  adminEmail: ADMIN_EMAIL,
});

export const GET = adminUserRouteHandlers.GET;
export const PATCH = adminUserRouteHandlers.PATCH;
export const DELETE = adminUserRouteHandlers.DELETE;
