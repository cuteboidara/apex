import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { ADMIN_EMAIL } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({
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
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json() as {
    action: "approve" | "suspend" | "ban" | "restore" | "unban";
    reason?: string;
  };

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let data: Record<string, unknown> = {};

  switch (body.action) {
    case "approve":
      data = { status: "APPROVED", approvedAt: new Date(), approvedBy: ADMIN_EMAIL, suspendedReason: null };
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

  const updated = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ success: true, status: updated.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
