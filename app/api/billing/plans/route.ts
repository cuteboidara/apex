import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { ensureActiveSubscriptionPlans } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

function getUserId(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plans = await ensureActiveSubscriptionPlans();

  return NextResponse.json({
    plans: plans.map(plan => ({
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      tier: plan.tier,
      monthlyPriceCents: plan.monthlyPriceCents,
      annualPriceCents: plan.annualPriceCents,
      features: Array.isArray(plan.features) ? plan.features : [],
    })),
  });
}

