import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { getMemePageData, getSystemStatusData } from "@/src/dashboard/data";
import { MemeCoinsPageClient } from "@/src/presentation/dashboard/components/MemeCoinsPageClient";

export async function MemeCoinsPage() {
  const [payload, status] = await Promise.all([
    getMemePageData(),
    getSystemStatusData(),
  ]);

  return (
    <ApexShell
      title="Meme Coins"
      subtitle="Dynamic meme-coin universe using CoinGecko discovery, Binance data where available, and volume-spike-driven SMC reads."
      mode={status.mode}
    >
      <MemeCoinsPageClient initialPayload={payload} />
    </ApexShell>
  );
}

export { MemeCoinsPage as MemecoinsPage };
