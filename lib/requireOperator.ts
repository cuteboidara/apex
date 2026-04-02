import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";

type OperatorSession = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

function hasOperatorIdentity(session: OperatorSession) {
  return Boolean(session?.user?.id || session?.user?.email);
}

export async function requireOperatorSession(
  getSession: () => Promise<OperatorSession> = () => getServerSession(authOptions) as Promise<OperatorSession>,
): Promise<
  | { ok: true; session: OperatorSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!hasOperatorIdentity(session)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, session };
}

export const requireOperator = requireOperatorSession;
