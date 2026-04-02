import { NextRequest, NextResponse } from "next/server";

import { validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";
import { setSetting } from "@/src/lib/operatorSettings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function getPrismaClient() {
  const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim();
  if (!url) {
    return null;
  }

  const { prisma } = await import("@/src/infrastructure/db/prisma");
  return prisma;
}

function unauthorizedResponse(request: NextRequest) {
  const auth = validateApexSecretRequest(request, process.env.APEX_SECRET);
  if (auth.ok) {
    return null;
  }

  return NextResponse.json(
    {
      error: auth.error,
    },
    { status: auth.status },
  );
}

export async function GET(request: NextRequest) {
  const authResponse = unauthorizedResponse(request);
  if (authResponse) {
    return authResponse;
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    return NextResponse.json(
      {
        error: "Database not configured",
      },
      { status: 500 },
    );
  }

  try {
    const settings = await prisma.operatorSettings.findMany({
      orderBy: { key: "asc" },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error("[admin/settings] Failed to read settings:", error);
    return NextResponse.json(
      {
        error: "Failed to read settings",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authResponse = unauthorizedResponse(request);
  if (authResponse) {
    return authResponse;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
      },
      { status: 400 },
    );
  }

  const key = typeof (body as { key?: unknown })?.key === "string"
    ? (body as { key: string }).key.trim()
    : "";
  const value = typeof (body as { value?: unknown })?.value === "string"
    ? (body as { value: string }).value
    : null;

  if (!key || value == null) {
    return NextResponse.json(
      {
        error: "Expected { key: string, value: string }",
      },
      { status: 400 },
    );
  }

  await setSetting(key, value);

  const prisma = await getPrismaClient();
  if (!prisma) {
    return NextResponse.json(
      {
        error: "Database not configured",
      },
      { status: 500 },
    );
  }

  try {
    const record = await prisma.operatorSettings.findUnique({
      where: { key },
    });

    if (!record) {
      return NextResponse.json(
        {
          error: "Failed to persist setting",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(record);
  } catch (error) {
    console.error("[admin/settings] Failed to persist setting:", error);
    return NextResponse.json(
      {
        error: "Failed to persist setting",
      },
      { status: 500 },
    );
  }
}
