import { prisma } from "../lib/prisma";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function backfill() {
  console.log("[backfill] Starting canonical field backfill...");

  const rows = await prisma.signalViewModel.findMany();
  const rowsToBackfill = rows.filter(row => row.commentary == null || row.ui_sections == null);

  let updated = 0;
  for (const row of rowsToBackfill) {
    const uiSections = asRecord(row.ui_sections);
    const model = asRecord(uiSections.model);
    const fallbackSummary = row.summary || "Historical signal — detailed reasoning not available for records prior to Phase 4.";

    await prisma.signalViewModel.update({
      where: {
        view_id: row.view_id,
      },
      data: {
        commentary: row.commentary ?? {
          short_reasoning: fallbackSummary,
          detailed_reasoning: fallbackSummary,
        },
        ui_sections: {
          ...uiSections,
          model: {
            ...model,
            shortReasoning: typeof model.shortReasoning === "string" ? model.shortReasoning : fallbackSummary,
            detailedReasoning: typeof model.detailedReasoning === "string" ? model.detailedReasoning : fallbackSummary,
            whyThisSetup: typeof model.whyThisSetup === "string" ? model.whyThisSetup : "",
            whyNow: typeof model.whyNow === "string" ? model.whyNow : "",
            whyThisLevel: typeof model.whyThisLevel === "string" ? model.whyThisLevel : "",
            invalidation: typeof model.invalidation === "string" ? model.invalidation : "",
            whyThisGrade: typeof model.whyThisGrade === "string" ? model.whyThisGrade : "",
          },
        },
      },
    });
    updated += 1;
  }

  console.log(`[backfill] Updated ${updated} signal view model records`);
  console.log("[backfill] Complete.");
}

backfill()
  .catch(error => {
    console.error("[backfill] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
