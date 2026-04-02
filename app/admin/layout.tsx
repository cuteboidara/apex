import { ApexAdminShell } from "@/src/presentation/admin/components/ApexAdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ApexAdminShell>{children}</ApexAdminShell>;
}
