export interface CommodityMacroContext {
  symbol: string;
  macroDirectionBias: "bullish" | "bearish" | "neutral";
  macroNote: string;
  macroScore: number;
}

export function getCommodityMacroContext(
  symbol: string,
  smcPDLocation: string,
): CommodityMacroContext {
  const isPreciousMetal = symbol === "XAUUSD" || symbol === "XAGUSD";
  const isEnergy = ["WTICOUSD", "BCOUSD", "NATGASUSD"].includes(symbol);

  let macroDirectionBias: CommodityMacroContext["macroDirectionBias"] = "neutral";
  let macroNote = "No macro overlay available";
  let macroScore = 50;

  if (isPreciousMetal) {
    if (smcPDLocation === "discount") {
      macroDirectionBias = "bullish";
      macroNote = "Precious metal in discount - historically favorable for long entries";
      macroScore = 65;
    } else if (smcPDLocation === "premium") {
      macroDirectionBias = "bearish";
      macroNote = "Precious metal in premium - elevated risk for longs, consider shorts";
      macroScore = 35;
    }
  }

  if (isEnergy) {
    if (smcPDLocation === "discount") {
      macroDirectionBias = "bullish";
      macroNote = "Energy commodity at discount - potential supply squeeze zone";
      macroScore = 60;
    } else if (smcPDLocation === "premium") {
      macroDirectionBias = "bearish";
      macroNote = "Energy at premium - demand destruction risk or oversupply narrative";
      macroScore = 40;
    }
  }

  return { symbol, macroDirectionBias, macroNote, macroScore };
}
