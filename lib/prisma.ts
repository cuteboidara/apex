import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as typeof globalThis & {
  __apexPrismaClient?: PrismaClient;
};

function getDatabaseUrl(): string {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Database configuration missing. Set DIRECT_DATABASE_URL or DATABASE_URL.");
  }
  return url;
}

function makePrisma() {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.__apexPrismaClient ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__apexPrismaClient = prisma;
}
