import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { createAdminUserRouteHandlers } from "@/app/api/admin/users/[id]/route";

test("admin user route blocks unauthorized moderation requests", async () => {
  const route = createAdminUserRouteHandlers({
    prisma: {} as never,
    requireAdmin: async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }),
    recordAuditEvent: async () => undefined,
    adminEmail: "admin@example.com",
  });

  const response = await route.PATCH(new Request("http://localhost/api/admin/users/user_1", {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
    headers: { "Content-Type": "application/json" },
  }) as never, {
    params: Promise.resolve({ id: "user_1" }),
  });

  assert.equal(response.status, 403);
});

test("admin user route records audit history on approval", async () => {
  const audits: Array<{ action: string; after?: object | null }> = [];
  const route = createAdminUserRouteHandlers({
    prisma: {
      user: {
        findUnique: async () => ({
          id: "user_1",
          status: "PENDING",
          suspendedReason: null,
          email: "trader@example.com",
        }),
        update: async () => ({
          id: "user_1",
          status: "APPROVED",
          suspendedReason: null,
        }),
      },
    } as never,
    requireAdmin: async () => ({ ok: true as const }),
    recordAuditEvent: async input => {
      audits.push({ action: input.action, after: input.after ?? null });
    },
    adminEmail: "admin@example.com",
  });

  const response = await route.PATCH(new Request("http://localhost/api/admin/users/user_1", {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
    headers: { "Content-Type": "application/json" },
  }) as never, {
    params: Promise.resolve({ id: "user_1" }),
  });
  const payload = await response.json() as { status: string };

  assert.equal(response.status, 200);
  assert.equal(payload.status, "APPROVED");
  assert.deepEqual(audits[0]?.action, "user_approve");
});
