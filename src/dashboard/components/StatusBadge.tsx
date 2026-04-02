import { Chip } from "@/src/components/apex-ui/Chip";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const variant = tone === "good" ? "active" : tone === "warn" ? "watchlist" : tone === "bad" ? "blocked" : "neutral";

  return <Chip label={label} variant={variant} />;
}
