/**
 * Creates or updates the admin account in the database.
 * Run: npx tsx scripts/seed-admin.ts
 *
 * Default password: Apex@Admin2026
 * Change it after first login.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const ADMIN_EMAIL    = "emmadara229@gmail.com";
const ADMIN_PASSWORD = "Apex@Admin2026";
const ADMIN_NAME     = "Admin";

const pool   = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where:  { email: ADMIN_EMAIL },
    update: { hashedPassword, status: "APPROVED", role: "ADMIN", name: ADMIN_NAME },
    create: {
      email: ADMIN_EMAIL,
      name:  ADMIN_NAME,
      hashedPassword,
      role:   "ADMIN",
      status: "APPROVED",
    },
  });

  console.log(`✅  Admin account ready: ${admin.email} (status: ${admin.status})`);
  console.log(`🔑  Password: ${ADMIN_PASSWORD}`);
  console.log(`⚠️   Change this password after first login.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
