import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

import { ADMIN_EMAIL } from "@/lib/admin/auth";

export function isAdminToken(token: { email?: string | null; role?: string | null } | null | undefined): boolean {
  const email = token?.email?.toLowerCase();
  return Boolean(
    (email != null && email === ADMIN_EMAIL.toLowerCase()) || token?.role === "ADMIN",
  );
}

export function isPublicApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/")
    || pathname === "/api/billing/crypto/webhook"
    || pathname === "/api/indices/amt/cron"
    || pathname === "/api/sniper/cron"
    || pathname === "/api/scalp/cron"
    || pathname === "/api/market/economic-calendar"
    || pathname === "/api/jobs/daily-signals"
    || pathname === "/api/telegram/webhook"
    || pathname === "/api/health";
}

export function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !isPublicApiPath(pathname);
}

export function shouldAllowAnonymousPath(pathname: string): boolean {
  return pathname === "/auth/signin"
    || pathname === "/auth/signup"
    || isPublicApiPath(pathname);
}

export const proxy = withAuth(
  function middleware(request) {
    const { pathname } = request.nextUrl;
    const token = request.nextauth.token;

    if (shouldAllowAnonymousPath(pathname)) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/admin")) {
      if (!token || !isAdminToken(token)) {
        return NextResponse.redirect(new URL("/auth/signin", request.url));
      }

      return NextResponse.next();
    }

    if (isProtectedApiPath(pathname)) {
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (pathname.startsWith("/api/admin/") && !isAdminToken(token)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      return NextResponse.next();
    }

    if (!token) {
      return NextResponse.redirect(new URL("/auth/signin", request.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: () => true,
    },
    pages: {
      signIn: "/auth/signin",
    },
  },
);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)",
  ],
};
