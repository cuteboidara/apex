import assert from "node:assert/strict";
import test from "node:test";

import { createPasswordRouteHandler } from "@/app/api/me/password/route";

test("password route rejects anonymous callers", async () => {
  const handler = createPasswordRouteHandler({
    getSession: (async () => null) as never,
  });

  const response = await handler(new Request("http://localhost/api/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "oldpass123", newPassword: "newpass123" }),
  }) as never);

  assert.equal(response.status, 401);
});

test("password route rejects wrong current password", async () => {
  let updated = false;

  const handler = createPasswordRouteHandler({
    getSession: (async () => ({ user: { id: "user_1", email: "operator@example.com" } })) as never,
    prismaClient: {
      user: {
        findUnique: async () => ({
          id: "user_1",
          email: "operator@example.com",
          hashedPassword: "stored_hash",
        }),
        update: async () => {
          updated = true;
          return null;
        },
      },
    } as never,
    comparePassword: (async () => false) as never,
  });

  const response = await handler(new Request("http://localhost/api/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "wrongpass123", newPassword: "newpass123" }),
  }) as never);
  const payload = await response.json() as { error: string };

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Current password is incorrect.");
  assert.equal(updated, false);
});

test("password route updates the stored password hash on success", async () => {
  let savedHash: string | null = null;
  let auditAction: string | null = null;

  const handler = createPasswordRouteHandler({
    getSession: (async () => ({ user: { id: "user_1", email: "operator@example.com" } })) as never,
    prismaClient: {
      user: {
        findUnique: async () => ({
          id: "user_1",
          email: "operator@example.com",
          hashedPassword: "stored_hash",
        }),
        update: async ({ data }: { data: { hashedPassword: string } }) => {
          savedHash = data.hashedPassword;
          return null;
        },
      },
    } as never,
    comparePassword: (async () => true) as never,
    hashPassword: (async (value: string) => `hashed:${value}`) as never,
    recordAudit: (async (input: { action: string }) => {
      auditAction = input.action;
    }) as never,
  });

  const response = await handler(new Request("http://localhost/api/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "oldpass123", newPassword: "newpass123" }),
  }) as never);
  const payload = await response.json() as { success: boolean };

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(savedHash, "hashed:newpass123");
  assert.equal(auditAction, "password_changed");
});
