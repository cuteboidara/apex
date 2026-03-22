import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { ADMIN_EMAIL } from "@/lib/admin/auth";

export const proxy = withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Protect /admin/* — only ADMIN_EMAIL may access
    if (pathname.startsWith("/admin")) {
      if (!token || token.email !== ADMIN_EMAIL) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
  },
  {
    pages: {
      signIn: "/auth/signin",
    },
  },
);

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     *  - /auth/* (sign-in, sign-up)
     *  - /api/auth/* (NextAuth endpoints)
     *  - /_next/* (Next.js internals)
     *  - /favicon.ico, /robots.txt, etc.
     */
    "/((?!auth|api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt).*)",
  ],
};
