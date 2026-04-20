import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { verifyCoinbaseWebhookSignature } from "@/lib/billing/coinbase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BillingCycle = "monthly" | "annual";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null ? value as Record<string, unknown> : {};
}

function resolveStatus(eventType: string, timelineStatus: string): string {
  const normalized = (timelineStatus || eventType || "").toLowerCase();

  if (normalized.includes("confirmed") || normalized.includes("completed") || normalized.includes("resolved")) {
    return "CONFIRMED";
  }
  if (normalized.includes("failed")) {
    return "FAILED";
  }
  if (normalized.includes("expired")) {
    return "EXPIRED";
  }
  if (normalized.includes("canceled")) {
    return "CANCELED";
  }
  return "PENDING";
}

function resolveTimelineStatus(data: Record<string, unknown>): string {
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const lastEntry = timeline.length > 0 ? asRecord(timeline[timeline.length - 1]) : null;
  return typeof lastEntry?.status === "string" ? lastEntry.status : "";
}

function resolveFirstTxHash(data: Record<string, unknown>): string | null {
  const payments = Array.isArray(data.payments) ? data.payments : [];
  for (const payment of payments) {
    const item = asRecord(payment);
    const tx = item.transaction_id;
    if (typeof tx === "string" && tx) {
      return tx;
    }
  }
  return null;
}

function getBillingCycle(value: unknown): BillingCycle {
  return value === "annual" ? "annual" : "monthly";
}

function addBillingPeriod(start: Date, cycle: BillingCycle): Date {
  const end = new Date(start);
  if (cycle === "annual") {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-cc-webhook-signature");
  if (!verifyCoinbaseWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const event = asRecord(payload.event);
  const eventType = typeof event.type === "string" ? event.type : "";
  const data = asRecord(event.data);
  const chargeId = typeof data.id === "string" ? data.id : "";
  if (!chargeId) {
    return NextResponse.json({ error: "Missing charge id" }, { status: 400 });
  }

  const timelineStatus = resolveTimelineStatus(data);
  const status = resolveStatus(eventType, timelineStatus);
  const txHash = resolveFirstTxHash(data);

  const existingPayment = await prisma.cryptoPayment.findUnique({
    where: { providerChargeId: chargeId },
  });

  if (!existingPayment) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  }

  const updatedPayment = await prisma.cryptoPayment.update({
    where: { id: existingPayment.id },
    data: {
      status,
      txHash: txHash ?? existingPayment.txHash,
      metadata: data as Prisma.InputJsonValue,
      confirmedAt: status === "CONFIRMED"
        ? existingPayment.confirmedAt ?? new Date()
        : existingPayment.confirmedAt,
    },
  });

  if (status === "CONFIRMED") {
    const metadata = asRecord(data.metadata);
    const billingCycle = getBillingCycle(metadata.billingCycle);
    const periodStart = new Date();
    const periodEnd = addBillingPeriod(periodStart, billingCycle);

    const currentSubscription = await prisma.userSubscription.findFirst({
      where: { userId: updatedPayment.userId },
      orderBy: { updatedAt: "desc" },
    });

    if (currentSubscription) {
      await prisma.userSubscription.update({
        where: { id: currentSubscription.id },
        data: {
          planId: updatedPayment.planId,
          status: "ACTIVE",
          billingSubscriptionId: chargeId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
        },
      });
    } else {
      await prisma.userSubscription.create({
        data: {
          userId: updatedPayment.userId,
          planId: updatedPayment.planId,
          status: "ACTIVE",
          seatCount: 1,
          billingSubscriptionId: chargeId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
