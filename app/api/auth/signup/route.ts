import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { ADMIN_EMAIL } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

async function notifyAdminTelegram(name: string, email: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const appUrl = process.env.NEXTAUTH_URL ?? "https://apex1-wine.vercel.app";
  const text = `🔔 New APEX signup request\n\nName: ${name}\nEmail: ${email}\nTime: ${new Date().toUTCString()}\n\nApprove: ${appUrl}/admin/users`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

async function notifyAdminEmail(name: string, email: string) {
  if (!process.env.RESEND_API_KEY) return;

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const appUrl = process.env.NEXTAUTH_URL ?? "https://apex1-wine.vercel.app";
  await resend.emails.send({
    from: "noreply@apex1-wine.vercel.app",
    to: ADMIN_EMAIL,
    subject: `New APEX Signup — ${name}`,
    html: `
      <div style="font-family:sans-serif;background:#080808;color:#e5e5e5;padding:24px;border-radius:8px;max-width:480px">
        <h2 style="color:#00ff88;margin-top:0">New Signup Request</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#999">Name</td><td style="padding:8px 0">${name}</td></tr>
          <tr><td style="padding:8px 0;color:#999">Email</td><td style="padding:8px 0">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#999">Time</td><td style="padding:8px 0">${new Date().toUTCString()}</td></tr>
        </table>
        <a href="${appUrl}/admin/users" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#00ff88;color:#000;border-radius:6px;text-decoration:none;font-weight:bold">Review in Admin</a>
      </div>
    `,
  }).catch(() => {});
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

        // Admin email is auto-approved
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

        // Notify admin for non-admin signups
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
            message: isAdmin
              ? "Account created."
              : "Account created. Pending admin approval.",
          },
          { status: 201 },
        );
      } catch {
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
      }
    },
  };
}

const signupRouteHandlers = createSignupRouteHandlers({
  prisma,
  adminEmail: ADMIN_EMAIL,
  hashPassword: bcrypt.hash,
  notifyAdminTelegram,
  notifyAdminEmail,
  recordAuditEvent,
});

export const POST = signupRouteHandlers.POST;
