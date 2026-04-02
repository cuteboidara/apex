/**
 * Creates or updates the admin account in the database.
 * Run:
 *   $env:ADMIN_EMAIL="admin@example.com"
 *   $env:ADMIN_PASSWORD="generated-password"
 *   $env:ADMIN_ROLE="ADMIN"
 *   node --import tsx scripts/seed-admin.ts
 */

import "./load-env.mjs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() ?? "daraemma555@gmail.com";
const ADMIN_NAME = process.env.ADMIN_NAME?.trim() || "Admin";
const ADMIN_ROLE = process.env.ADMIN_ROLE?.trim() || "ADMIN";

function getAdminPassword() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is required.");
  }

  return password;
}

const pool   = new Pool({ connectionString: process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const hashedPassword = await bcrypt.hash(getAdminPassword(), 12);

  const admin = await prisma.user.upsert({
    where:  { email: ADMIN_EMAIL },
    update: { hashedPassword, status: "APPROVED", role: ADMIN_ROLE, name: ADMIN_NAME },
    create: {
      email: ADMIN_EMAIL,
      name:  ADMIN_NAME,
      hashedPassword,
      role: ADMIN_ROLE,
      status: "APPROVED",
    },
  });

  console.log(`✅  Admin account ready: ${admin.email} (status: ${admin.status})`);
  console.log(`🛡️  Role: ${admin.role}`);
  console.log(`⚠️  Password was supplied via ADMIN_PASSWORD; rotate it after first login.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
