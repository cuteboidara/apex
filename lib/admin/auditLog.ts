import { prisma } from "@/lib/prisma";

export async function auditLog(action: string, adminId: string, metadata?: object): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        action,
        adminId,
        metadata: metadata ? JSON.stringify(metadata) : null,
        timestamp: new Date(),
      },
    });
  } catch {
    // Audit logging must never fail primary admin actions.
  }
}
