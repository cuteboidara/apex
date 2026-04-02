"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function PodToggleButton({
  podId,
  active,
}: {
  podId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const response = await fetch(`/api/pods/${podId}/${active ? "pause" : "resume"}`, {
          method: "POST",
        });
        if (response.ok) {
          router.refresh();
        }
      })}
      className="apex-button apex-button-muted px-4 disabled:opacity-60"
    >
      {pending ? "Updating" : active ? "Pause" : "Resume"}
    </button>
  );
}
