import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function notifyAdminTelegram(name: string, email: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return;
  }

  const text = `New APEX signup request\n\nName: ${name}\nEmail: ${email}\nTime: ${new Date().toUTCString()}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined);
}

export async function notifyAdminEmail(name: string, email: string) {
  void name;
  void email;
  return;
}

type SignupRouteDependencies = {
  prisma: typeof prisma;
  adminEmail: string;
  hashPassword: typeof bcrypt.hash;
  notifyAdminTelegram: typeof notifyAdminTelegram;
  notifyAdminEmail: typeof notifyAdminEmail;
  recordAuditEvent: typeof recordAuditEvent;
};

export function createSignupRouteHandlers(deps: SignupRouteDependencies) {
  return {
    POST: async (req: NextRequest) => {
      try {
        const { name, email, password } = await req.json() as {
          name?: string;
          email?: string;
          password?: string;
        };

        if (!name?.trim() || !email?.trim() || !password) {
          return NextResponse.json({ error: "All fields are required." }, { status: 400 });
        }
        if (password.length < 8) {
          return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existing = await deps.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
          return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
        }

        const hashedPassword = await deps.hashPassword(password, 12);
        const isAdmin = normalizedEmail === deps.adminEmail;
        const user = await deps.prisma.user.create({
          data: {
            name: name.trim(),
            email: normalizedEmail,
            hashedPassword,
            role: isAdmin ? "ADMIN" : "MEMBER",
            status: isAdmin ? "APPROVED" : "PENDING",
            approvedAt: isAdmin ? new Date() : undefined,
            approvedBy: isAdmin ? "system" : undefined,
          },
        });

        await deps.recordAuditEvent({
          actor: "ANONYMOUS",
          action: "signup_created",
          entityType: "User",
          entityId: user.id,
          after: {
            email: user.email,
            role: user.role,
            status: user.status,
          },
        });

        if (!isAdmin) {
          await Promise.allSettled([
            deps.notifyAdminTelegram(name.trim(), normalizedEmail),
            deps.notifyAdminEmail(name.trim(), normalizedEmail),
          ]);
        }

        return NextResponse.json(
          {
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
            message: isAdmin ? "Account created." : "Account created. Pending admin approval.",
          },
          { status: 201 },
        );
      } catch {
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
      }
    },
  };
}

export async function POST() {
  return NextResponse.json({ error: "Registration is not open" }, { status: 403 });
}
