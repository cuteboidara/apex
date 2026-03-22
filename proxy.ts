import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  pages: {
    signIn: "/auth/signin",
  },
});

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
