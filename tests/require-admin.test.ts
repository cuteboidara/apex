import assert from "node:assert/strict";
import test from "node:test";

import { requireAdminWithDependencies } from "@/lib/admin/requireAdmin";

function createQuotaError(): Error {
  const error = new Error("Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.");
  error.name = "DriverAdapterError";
  return error;
}

test("requireAdmin trusts the existing admin session when the repository is unavailable", async () => {
  const result = await requireAdminWithDependencies({
    getSession: async () => ({
      user: {
        id: "user_admin",
        email: "daraemma555@gmail.com",
        role: "ADMIN",
      },
    }),
    prismaClient: {
      user: {
        findFirst: async () => {
          throw createQuotaError();
        },
      },
    } as never,
  });

  assert.equal(result.ok, true);
});

test("requireAdmin still blocks non-admin sessions when the repository is unavailable", async () => {
  const result = await requireAdminWithDependencies({
    getSession: async () => ({
      user: {
        id: "user_member",
        email: "member@example.com",
        role: "MEMBER",
      },
    }),
    prismaClient: {
      user: {
        findFirst: async () => {
          throw createQuotaError();
        },
      },
    } as never,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected a forbidden response");
  }
  assert.equal(result.response.status, 403);
});
