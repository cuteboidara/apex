import { NextResponse } from "next/server";

type RouteErrorInput = {
  publicMessage: string;
  fallbackStatus?: number;
};

export type RouteErrorPayload = {
  error: string;
  code: "BAD_REQUEST" | "INTERNAL_ERROR" | "MIGRATION_REQUIRED";
  details: string;
  likelyMigrationIssue: boolean;
  hint: string | null;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

export function isLikelyMigrationIssue(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  const code = readErrorCode(error);

  return code === "P2021" ||
    code === "P2022" ||
    message.includes("does not exist in the current database") ||
    message.includes("the table") && message.includes("does not exist") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist");
}

export function buildRouteErrorResponse(error: unknown, input: RouteErrorInput) {
  const details = toErrorMessage(error);

  if (isLikelyMigrationIssue(error)) {
    const payload: RouteErrorPayload = {
      error: `${input.publicMessage} is unavailable because required database tables or columns are missing.`,
      code: "MIGRATION_REQUIRED",
      details,
      likelyMigrationIssue: true,
      hint: "Run `npm run migrate:deploy` to apply prisma/migrations/20260323140000_add_signal_product_foundations.",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  const payload: RouteErrorPayload = {
    error: input.publicMessage,
    code: input.fallbackStatus === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR",
    details,
    likelyMigrationIssue: false,
    hint: null,
  };
  return NextResponse.json(payload, { status: input.fallbackStatus ?? 500 });
}
