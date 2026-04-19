import { AMTSidebar } from "@/src/presentation/layout/AMTSidebar";

export default function IndicesV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <AMTSidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
