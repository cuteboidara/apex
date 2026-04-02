import "../scripts/load-env.mjs";

import { prisma } from "../lib/prisma";

async function main() {
  await prisma.operatorSettings.upsert({
    where: { key: "telegram_min_grade" },
    update: {
      value: "B",
      description: "Minimum grade for Telegram signal delivery. Values: S+, S, A, B, C, D, F",
    },
    create: {
      key: "telegram_min_grade",
      value: "B",
      description: "Minimum grade for Telegram signal delivery. Values: S+, S, A, B, C, D, F",
    },
  });

  await prisma.operatorSettings.upsert({
    where: { key: "telegram_include_b_grade" },
    update: {
      value: "true",
      description: "Whether to include B-grade signals in Telegram delivery. Values: true | false",
    },
    create: {
      key: "telegram_include_b_grade",
      value: "true",
      description: "Whether to include B-grade signals in Telegram delivery. Values: true | false",
    },
  });
}

void main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
