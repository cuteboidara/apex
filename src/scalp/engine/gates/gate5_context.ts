import { getCurrentSession } from "@/src/scalp/data/fetchers/sessionDetector";
import { calculateATR } from "@/src/scalp/engine/gates/indicators";
import type { ContextGateResult, ScalpCandle, Session, UpcomingNewsEvent } from "@/src/scalp/types/scalpTypes";

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object" && "time" in (value as Record<string, unknown>)) {
    return toEpochMs((value as Record<string, unknown>).time);
  }

  return null;
}

function sessionScore(session: Session, preferred: Session[]): { pass: boolean; score: number } {
  const pass = preferred.includes(session);
  const score = session === "overlap" ? 5 : pass ? 4 : 0;
  return { pass, score };
}

export function checkContext(
  candles15m: ScalpCandle[],
  preferredSessions: Session[],
  upcomingNews: UpcomingNewsEvent[],
): ContextGateResult {
  if (candles15m.length < 25) {
    return {
      pass: false,
      score: 0,
      session: getCurrentSession(),
      atrPct: 0,
      newsBlocked: false,
      reasoning: "Insufficient candles for context gate",
    };
  }

  const currentSession = getCurrentSession();
  const session = sessionScore(currentSession, preferredSessions);

  const atr14 = calculateATR(candles15m.slice(-25), 14);
  const atr20 = calculateATR(candles15m.slice(-30), 20);
  const atrPct = atr20 > 0 ? atr14 / atr20 : 1;
  const volatilityPass = atrPct >= 0.7 && atrPct <= 1.5;
  const volatilityScore = atrPct >= 0.9 && atrPct <= 1.3 ? 5 : volatilityPass ? 3 : 0;

  const now = Date.now();
  const newsBlocked = upcomingNews.some(event => {
    const timeMs = toEpochMs(event.time);
    if (timeMs == null) return false;

    const diffMinutes = (timeMs - now) / 60000;
    const impact = typeof event.impact === "string" ? event.impact.toLowerCase() : "";
    return impact === "high" && diffMinutes > -30 && diffMinutes < 30;
  });

  const newsScore = newsBlocked ? 0 : 5;
  const total = session.score + volatilityScore + newsScore;
  const pass = session.pass && volatilityPass && !newsBlocked;

  return {
    pass,
    score: total,
    session: currentSession,
    atrPct,
    newsBlocked,
    reasoning: `Session ${currentSession}, ATR ${(atrPct * 100).toFixed(0)}%, News ${newsBlocked ? "BLOCKED" : "clear"}`,
  };
}
