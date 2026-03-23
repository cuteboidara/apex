import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ADMIN_EMAIL } from "@/lib/admin/auth";

export async function requireAdmin(): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  const isAdmin =
    Boolean(session?.user?.email && session.user.email === ADMIN_EMAIL) ||
    (session?.user ? ((session.user as { role?: string }).role === "ADMIN") : false);
  if (!isAdmin) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}
