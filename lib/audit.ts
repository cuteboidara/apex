import { prisma } from "@/lib/prisma";

type AuditInput = {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: object | null;
  after?: object | null;
  correlationId?: string | null;
};

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actor: input.actor,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        correlationId: input.correlationId ?? undefined,
      },
    });
  } catch {
    // Audit logging must not break primary execution paths.
  }
}
