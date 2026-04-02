export function gradeMemeSignal(
  smcScore: number,
  confidence: number,
  volumeSpike: { isSpike: boolean; spikeStrength: string; spikeMultiplier: number },
  isBase: boolean,
): { grade: string; gradeScore: number } {
  let rawScore = Math.round((smcScore * 0.4) + (confidence * 100 * 0.6));

  if (volumeSpike.isSpike) {
    rawScore += volumeSpike.spikeStrength === "extreme"
      ? 12
      : volumeSpike.spikeStrength === "strong"
        ? 8
        : 4;
  }

  if (isBase) {
    rawScore = Math.min(100, rawScore + 5);
  }

  const gradeScore = Math.min(100, rawScore);
  const grade = gradeScore >= 75
    ? "A"
    : gradeScore >= 66
      ? "B"
      : gradeScore >= 56
        ? "C"
        : gradeScore >= 46
          ? "D"
          : "F";

  return { grade, gradeScore };
}
