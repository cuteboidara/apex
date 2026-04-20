import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { createCoinbaseCharge } from "@/lib/billing/coinbase";
import { ensureActiveSubscriptionPlans, resolvePlanAmountCents } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BillingCycle = "monthly" | "annual";

function getSessionUser(session: unknown) {
  return (session as { user?: { id?: string; email?: string | null } } | null)?.user ?? null;
}

function normalizeBillingCycle(value: unknown): BillingCycle {
  return value === "annual" ? "annual" : "monthly";
}

function resolveCryptoQuote(pricing: Record<string, { amount: string; currency: string }>) {
  const preferred = ["usdc", "usdt", "bitcoin", "ethereum", "litecoin"];
  for (const key of preferred) {
    const quote = pricing[key];
    if (quote && typeof quote.amount === "string" && typeof quote.currency === "string") {
      return quote;
    }
  }

  const first = Object.values(pricing).find(
    quote => typeof quote.amount === "string" && typeof quote.currency === "string",
  );
  return first ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = getSessionUser(session);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as {
      planSlug?: string;
      billingCycle?: BillingCycle;
    } | null;

    const planSlug = body?.planSlug?.trim().toLowerCase();
    const billingCycle = normalizeBillingCycle(body?.billingCycle);
    if (!planSlug) {
      return NextResponse.json({ error: "Plan is required." }, { status: 400 });
    }

    const plans = await ensureActiveSubscriptionPlans();
    const plan = plans.find(item => item.slug.toLowerCase() === planSlug && item.active);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    const amountCents = resolvePlanAmountCents(plan, billingCycle);
    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ error: "Selected billing cycle is unavailable for this plan." }, { status: 400 });
    }

    const pendingPayment = await prisma.cryptoPayment.findFirst({
      where: {
        userId: user.id,
        planId: plan.id,
        status: "PENDING",
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (pendingPayment) {
      return NextResponse.json({
        checkoutUrl: pendingPayment.checkoutUrl,
        paymentId: pendingPayment.id,
        providerChargeId: pendingPayment.providerChargeId,
        expiresAt: pendingPayment.expiresAt,
        reused: true,
      });
    }

    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || req.nextUrl.origin;
    const charge = await createCoinbaseCharge({
      amountCents,
      name: `${plan.name} Plan`,
      description: `APEX ${billingCycle} subscription`,
      metadata: {
        userId: user.id,
        email: user.email ?? "",
        planId: plan.id,
        planSlug: plan.slug,
        billingCycle,
      },
      redirectUrl: `${baseUrl}/account?checkout=success`,
      cancelUrl: `${baseUrl}/account?checkout=cancel`,
    });

    const cryptoQuote = resolveCryptoQuote(charge.pricing);

    const payment = await prisma.cryptoPayment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        provider: "coinbase_commerce",
        providerChargeId: charge.chargeId,
        status: "PENDING",
        amountUsd: amountCents,
        currency: "USD",
        assetSymbol: cryptoQuote?.currency ?? null,
        amountCrypto: cryptoQuote ? Number.parseFloat(cryptoQuote.amount) : null,
        paymentAddress: null,
        checkoutUrl: charge.hostedUrl,
        metadata: {
          billingCycle,
          pricing: charge.pricing,
          addresses: charge.addresses,
        },
        expiresAt: charge.expiresAt ? new Date(charge.expiresAt) : null,
      },
    });

    return NextResponse.json({
      checkoutUrl: payment.checkoutUrl,
      paymentId: payment.id,
      providerChargeId: payment.providerChargeId,
      expiresAt: payment.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create crypto checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
