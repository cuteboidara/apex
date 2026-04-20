import type { Session } from "@/src/sniper/types/sniperTypes";

export function getCurrentSession(now = new Date()): Session {
  const utcHour = now.getUTCHours();

  const isTokyo = utcHour >= 0 && utcHour < 9;
  const isLondon = utcHour >= 8 && utcHour < 17;
  const isNY = utcHour >= 13 && utcHour < 22;

  if ((isLondon && isNY) || (isTokyo && isLondon)) return "overlap";
  if (isLondon) return "london";
  if (isNY) return "ny";
  if (isTokyo) return "tokyo";
  return "off";
}

export function getSessionScore(session: Session): number {
  switch (session) {
    case "overlap":
      return 20;
    case "london":
    case "ny":
      return 15;
    case "tokyo":
      return 10;
    case "off":
      return 0;
  }
}

export function isAssetInPreferredSession(
  preferredSessions: readonly string[],
  session = getCurrentSession(),
): boolean {
  return preferredSessions.includes(session);
}

