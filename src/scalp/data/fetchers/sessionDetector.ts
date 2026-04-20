import type { Session } from "@/src/scalp/types/scalpTypes";

export function getCurrentSession(): Session {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const isTokyo = utcHour >= 0 && utcHour < 9;
  const isLondon = utcHour >= 8 && utcHour < 17;
  const isNY = utcHour >= 13 && utcHour < 22;

  if (isLondon && isNY) return "overlap";
  if (isTokyo && isLondon) return "overlap";
  if (isLondon) return "london";
  if (isNY) return "ny";
  if (isTokyo) return "tokyo";
  return "off";
}
