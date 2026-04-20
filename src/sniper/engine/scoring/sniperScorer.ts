export interface SniperScoreInput {
  sweepQuality: number;
  rejection: number;
  structure: number;
  session: number;
}

export function scoreSniperSetup(input: SniperScoreInput): number {
  const total = input.sweepQuality + input.rejection + input.structure + input.session;
  return Math.max(0, Math.min(100, Math.round(total)));
}

