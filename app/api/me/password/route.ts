import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";

import { recordAuditEvent } from "@/lib/audit";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getSessionUser(session: unknown) {
  return (session as { user?: { id?: string; email?: string | null } } | null)?.user ?? null;
}

type PasswordRouteDependencies = {
  getSession?: typeof getServerSession;
  prismaClient?: typeof prisma;
  comparePassword?: typeof bcrypt.compare;
  hashPassword?: typeof bcrypt.hash;
  recordAudit?: typeof recordAuditEvent;
};

export function createPasswordRouteHandler(deps: PasswordRouteDependencies = {}) {
  return async function POST(req: NextRequest) {
    const session = await (deps.getSession ?? getServerSession)(authOptions);
    const user = getSessionUser(session);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as {
      currentPassword?: string;
      newPassword?: string;
    } | null;

    const currentPassword = body?.currentPassword?.trim() ?? "";
    const newPassword = body?.newPassword?.trim() ?? "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }

    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "New password must be different from the current password." }, { status: 400 });
    }

    const prismaClient = deps.prismaClient ?? prisma;
    const account = await prismaClient.user.findUnique({
      where: { id: user.id },
    });

    if (!account) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const compare = deps.comparePassword ?? bcrypt.compare;
    const valid = await compare(currentPassword, account.hashedPassword);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    const hash = deps.hashPassword ?? bcrypt.hash;
    const hashedPassword = await hash(newPassword, 12);

    await prismaClient.user.update({
      where: { id: account.id },
      data: { hashedPassword },
    });

    await (deps.recordAudit ?? recordAuditEvent)({
      actor: account.email,
      action: "password_changed",
      entityType: "User",
      entityId: account.id,
      after: {
        email: account.email,
      },
    });

    return NextResponse.json({ success: true });
  };
}

export const POST = createPasswordRouteHandler();
