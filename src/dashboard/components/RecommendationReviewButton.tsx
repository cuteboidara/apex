"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RecommendationReviewButton({
  snapshotId,
  pair,
  action,
}: {
  snapshotId: string;
  pair: string;
  action: "approve" | "reject";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        if (!window.confirm(`${action === "approve" ? "Approve" : "Reject"} the ${pair} proposal?`)) {
          return;
        }

        const response = await fetch(`/api/recommendations/${snapshotId}/review`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pair,
            action,
          }),
        });

        if (response.ok) {
          router.refresh();
        }
      })}
      className={`rounded-[var(--apex-radius-md)] border px-4 py-2 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] disabled:opacity-60 ${
        action === "approve"
          ? "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]"
          : "border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]"
      }`}
    >
      {pending ? "Updating" : action === "approve" ? "Approve" : "Reject"}
    </button>
  );
}
