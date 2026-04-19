import { IndicesV2Dashboard } from '@/src/presentation/indices/IndicesV2Dashboard';
import type { Metadata } from "next";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "APEX V2 - AMT Trading Dashboard",
  description: "Auction Market Theory trading signals for NAS100, SPX500, DAX, EURUSD, GBPUSD, USDJPY, AUDUSD",
};

export default function Page() {
  return <IndicesV2Dashboard section="overview" />;
}
