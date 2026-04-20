import type { ReactNode } from "react";
import { ScalpSidebar } from "@/src/presentation/scalp/ScalpSidebar";

export default function ScalpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <ScalpSidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
