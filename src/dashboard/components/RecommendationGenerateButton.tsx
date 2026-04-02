"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RecommendationGenerateButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const response = await fetch("/api/recommendations", {
          method: "POST",
        });
        if (response.ok) {
          router.refresh();
        }
      })}
      className="apex-button apex-button-amber disabled:opacity-60"
    >
      {pending ? "Generating" : "Generate Snapshot"}
    </button>
  );
}
