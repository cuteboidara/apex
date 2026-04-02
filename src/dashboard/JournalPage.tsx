import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { JournalFeedClient } from "@/src/dashboard/components/JournalFeedClient";
import { getJournalPageData, getSystemStatusData } from "@/src/dashboard/data";

export async function JournalPage() {
  const [journal, status] = await Promise.all([
    getJournalPageData(),
    getSystemStatusData(),
  ]);

  return (
    <ApexShell
      title="Decision Journal"
      subtitle="Append-only execution trace with queryable filters, expandable references, and operator-readable rationale for every material decision."
      mode={status.mode}
    >
      <JournalFeedClient initialEntries={journal} />
    </ApexShell>
  );
}
