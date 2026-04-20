import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { BillingCryptoCard } from "@/src/presentation/dashboard/components/BillingCryptoCard";
import { PasswordSettingsCard } from "@/src/presentation/dashboard/components/PasswordSettingsCard";

function resolveSessionUser(session: unknown) {
  return (session as { user?: { email?: string | null; name?: string | null } } | null)?.user ?? null;
}

export async function AccountPage() {
  const session = await getServerSession(authOptions);
  const user = resolveSessionUser(session);

  return (
    <ApexShell
      title="Account"
      subtitle="Manage operator credentials and subscription billing."
      mode="normal"
    >
      <PasswordSettingsCard email={user?.email ?? "unknown"} />
      <BillingCryptoCard />
    </ApexShell>
  );
}
