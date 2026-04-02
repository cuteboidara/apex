"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function AlphaAnalyticsRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const response = await fetch("/api/validation", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "refresh_alpha_analytics",
          }),
        });
        if (response.ok) {
          router.refresh();
        }
      })}
      className="apex-button disabled:opacity-60"
    >
      {pending ? "Refreshing" : "Refresh Alpha Analytics"}
    </button>
  );
}
