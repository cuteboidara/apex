import type { ReactNode } from "react";
import { SniperSidebar } from "@/src/presentation/sniper/SniperSidebar";

export default function SniperLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <SniperSidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

