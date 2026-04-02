import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { AUTH_SERVICE_UNAVAILABLE } from "@/src/lib/authErrors";
import { prisma } from "@/src/infrastructure/db/prisma";

function isAuthStorageUnavailable(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  const normalized = message.toLowerCase();

  return normalized.includes("driveradaptererror")
    || normalized.includes("data transfer quota")
    || normalized.includes("repository unavailable")
    || normalized.includes("prismaclientinitializationerror")
    || normalized.includes("can't reach database server");
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = credentials.email.toLowerCase().trim();

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        }).catch(error => {
          if (isAuthStorageUnavailable(error)) {
            throw new Error(AUTH_SERVICE_UNAVAILABLE);
          }
          throw error;
        });
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.hashedPassword);
        if (!valid) return null;

        if (user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          if (user.status === "PENDING") {
            throw new Error("Your account is pending approval. You will be notified when approved.");
          }
          if (user.status === "SUSPENDED") {
            throw new Error("Your account has been suspended. Contact support.");
          }
          if (user.status === "BANNED") {
            throw new Error("Your account has been banned.");
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            loginCount: { increment: 1 },
          },
        }).catch(error => {
          console.warn("[auth] Failed to record login metadata:", error);
        });

        return { id: user.id, name: user.name ?? "", email: user.email, role: user.role };
      },
    }),
  ],

  pages: {
    signIn: "/auth/signin",
  },

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "MEMBER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
