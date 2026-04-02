import { ApexShell } from "@/src/dashboard/components/ApexShell";
import {
  getCommoditiesPageData,
  getCryptoPageData,
  getIndicesPageData,
  getMemePageData,
  getSignalsPageData,
  getStocksPageData,
  getSystemStatusData,
} from "@/src/dashboard/data";
import { UnifiedSignalsPageClient } from "@/src/presentation/dashboard/components/UnifiedSignalsPageClient";

export async function SignalsPage() {
  const [payload, crypto, stocks, commodities, indices, memecoins, status] = await Promise.all([
    getSignalsPageData(),
    getCryptoPageData(),
    getStocksPageData(),
    getCommoditiesPageData(),
    getIndicesPageData(),
    getMemePageData(),
    getSystemStatusData(),
  ]);

  return (
    <ApexShell
      title="Signals"
      subtitle="Unified multi-asset signal feed across forex, crypto, stocks, commodities, indices, and meme coins."
      mode={status.mode}
    >
      <UnifiedSignalsPageClient
        initialSignals={payload}
        initialCrypto={crypto}
        initialStocks={stocks}
        initialCommodities={commodities}
        initialIndices={indices}
        initialMemecoins={memecoins}
      />
    </ApexShell>
  );
}
