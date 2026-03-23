import assert from "node:assert/strict";
import test from "node:test";

import { createSignupRouteHandlers } from "@/app/api/auth/signup/route";

test("signup route creates pending users, notifies admins, and records audit history", async () => {
  const audits: Array<{ action: string }> = [];
  const notifications: string[] = [];
  const route = createSignupRouteHandlers({
    prisma: {
      user: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "user_1",
          email: data.email,
          name: data.name,
          role: data.role,
          status: data.status,
        }),
      },
    } as unknown as never,
    adminEmail: "admin@example.com",
    hashPassword: async () => "hashed-password",
    notifyAdminTelegram: async () => {
      notifications.push("telegram");
    },
    notifyAdminEmail: async () => {
      notifications.push("email");
    },
    recordAuditEvent: async input => {
      audits.push({ action: input.action });
    },
  });

  const response = await route.POST(new Request("http://localhost/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Trader",
      email: "trader@example.com",
      password: "supersecurepassword",
    }),
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as { status: string; message: string };

  assert.equal(response.status, 201);
  assert.equal(payload.status, "PENDING");
  assert.match(payload.message, /Pending admin approval/i);
  assert.deepEqual(notifications.sort(), ["email", "telegram"]);
  assert.deepEqual(audits, [{ action: "signup_created" }]);
});
