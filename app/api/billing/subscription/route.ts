import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { ensureActiveSubscriptionPlans } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

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

  await ensureActiveSubscriptionPlans();

  const [subscription, payments] = await Promise.all([
    prisma.userSubscription.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.cryptoPayment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const plan = subscription?.planId
    ? await prisma.subscriptionPlan.findUnique({ where: { id: subscription.planId } })
    : null;

  return NextResponse.json({
    subscription: subscription
      ? {
        ...subscription,
        plan: plan
          ? {
            id: plan.id,
            slug: plan.slug,
            name: plan.name,
            tier: plan.tier,
            monthlyPriceCents: plan.monthlyPriceCents,
            annualPriceCents: plan.annualPriceCents,
          }
          : null,
      }
      : null,
    payments: payments.map(payment => ({
      id: payment.id,
      status: payment.status,
      provider: payment.provider,
      providerChargeId: payment.providerChargeId,
      checkoutUrl: payment.checkoutUrl,
      amountUsd: payment.amountUsd,
      currency: payment.currency,
      assetSymbol: payment.assetSymbol,
      amountCrypto: payment.amountCrypto,
      expiresAt: payment.expiresAt,
      confirmedAt: payment.confirmedAt,
      createdAt: payment.createdAt,
    })),
  });
}

