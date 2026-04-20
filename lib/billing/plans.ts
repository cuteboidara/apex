import type { SubscriptionPlan } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type BillingCycle = "monthly" | "annual";

type DefaultPlan = {
  slug: string;
  name: string;
  tier: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  features: string[];
};

const DEFAULT_SUBSCRIPTION_PLANS: DefaultPlan[] = [
  {
    slug: "starter",
    name: "Starter",
    tier: "STARTER",
    monthlyPriceCents: 2900,
    annualPriceCents: 29000,
    features: [
      "Signal feed access",
      "Telegram alerts",
      "Up to 1 active seat",
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    tier: "PRO",
    monthlyPriceCents: 7900,
    annualPriceCents: 79000,
    features: [
      "All starter features",
      "Priority runtime updates",
      "Advanced setup analytics",
    ],
  },
  {
    slug: "desk",
    name: "Desk",
    tier: "DESK",
    monthlyPriceCents: 19900,
    annualPriceCents: 199000,
    features: [
      "All pro features",
      "Multi-seat billing",
      "Dedicated support channel",
    ],
  },
];

export function resolvePlanAmountCents(plan: SubscriptionPlan, cycle: BillingCycle): number | null {
  if (cycle === "annual") {
    return plan.annualPriceCents ?? null;
  }
  return plan.monthlyPriceCents ?? null;
}

export async function ensureActiveSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const existing = await prisma.subscriptionPlan.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length > 0) {
    return existing;
  }

  await Promise.all(
    DEFAULT_SUBSCRIPTION_PLANS.map(plan =>
      prisma.subscriptionPlan.upsert({
        where: { slug: plan.slug },
        create: {
          slug: plan.slug,
          name: plan.name,
          tier: plan.tier,
          active: true,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          features: plan.features,
        },
        update: {
          name: plan.name,
          tier: plan.tier,
          active: true,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          features: plan.features,
        },
      }),
    ),
  );

  return prisma.subscriptionPlan.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
}

