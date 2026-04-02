import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { prisma } from "@/lib/prisma";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
} | null;

function isAdminSession(session: AdminSession): boolean {
  const email = session?.user?.email?.toLowerCase();
  return session?.user?.role === "ADMIN"
    || (email != null && email === ADMIN_EMAIL.toLowerCase());
}

function isRepositoryUnavailable(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  const normalized = message.toLowerCase();

  return normalized.includes("driveradaptererror")
    || normalized.includes("data transfer quota")
    || normalized.includes("repository unavailable")
    || normalized.includes("prismaclientinitializationerror")
    || normalized.includes("can't reach database server");
}

export async function requireAdmin(): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  return requireAdminWithDependencies();
}

export async function requireAdminWithDependencies(deps: {
  getSession?: () => Promise<AdminSession>;
  prismaClient?: typeof prisma;
} = {}): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const session = await (deps.getSession ?? (() => getServerSession(authOptions) as Promise<AdminSession>))();
  const userId = (session?.user as { id?: string | null } | undefined)?.id ?? null;
  const userEmail = session?.user?.email?.toLowerCase() ?? null;

  if (!userId && !userEmail) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await (deps.prismaClient ?? prisma).user.findFirst({
    where: userId
      ? { id: userId }
      : { email: userEmail ?? undefined },
    select: {
      email: true,
      role: true,
    },
  }).catch(error => {
    if (isRepositoryUnavailable(error)) {
      return isAdminSession(session)
        ? { email: userEmail, role: session?.user?.role ?? null }
        : null;
    }
    throw error;
  });

  const isAdmin = Boolean(
    user?.role === "ADMIN"
    || (user?.email != null && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()),
  );

  if (!isAdmin) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}
