import assert from "node:assert/strict";
import test from "node:test";

import { ApexRepository } from "@/src/lib/repository";

function setPrismaClient(
  repository: ApexRepository,
  prisma: {
    systemEvent?: {
      create?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      findFirst?: (args?: Record<string, unknown>) => Promise<unknown>;
    };
  },
): void {
  (repository as unknown as { prismaPromise?: Promise<unknown> }).prismaPromise = Promise.resolve(prisma);
}

test("appendSystemEvent keeps the cycle path alive when persistence is unavailable", async () => {
  const repository = new ApexRepository({ mode: "database" });
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(arg => String(arg)).join(" "));
  };

  try {
    setPrismaClient(repository, {
      systemEvent: {
        create: async () => {
          throw new Error("DriverAdapterError: quota exceeded");
        },
      },
    });

    await repository.appendSystemEvent({
      event_id: "sysevt_test_1",
      ts: Date.now(),
      module: "engine",
      type: "cycle_scope_applied",
      reason: "test",
      payload: {},
    });

    assert.equal(repository.getSystemEvents().length, 1);
    assert.match(logged.join("\n"), /Failed to persist system event; continuing cycle with in-memory event only/);
    assert.match(logged.join("\n"), /DriverAdapterError: quota exceeded/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("verifyPersistenceReadiness reports unavailable persistence without throwing", async () => {
  const repository = new ApexRepository({ mode: "database" });
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(arg => String(arg)).join(" "));
  };

  try {
    setPrismaClient(repository, {
      systemEvent: {
        findFirst: async () => {
          throw new Error("DriverAdapterError: relation apex.SystemEvent does not exist");
        },
      },
    });

    const ready = await repository.verifyPersistenceReadiness("cycle_start:test");

    assert.equal(ready, false);
    assert.match(logged.join("\n"), /Repository persistence preflight failed/);
    assert.match(logged.join("\n"), /relation apex\.SystemEvent does not exist/);
  } finally {
    console.error = originalConsoleError;
  }
});
