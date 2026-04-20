"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    section: "SNIPER",
    items: [
      { label: "Live Signals", href: "/sniper" },
      { label: "Active Trades", href: "/sniper/active" },
      { label: "History", href: "/sniper/history" },
      { label: "Performance", href: "/sniper/stats" },
    ],
  },
  {
    section: "BACK",
    items: [
      { label: "Swing Dashboard", href: "/indices-v2" },
    ],
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/sniper") return pathname === "/sniper";
  return pathname.startsWith(href);
}

export function SniperSidebar() {
  const pathname = usePathname();

  return (
    <aside className="relative w-64 shrink-0 border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded border border-red-500/40 bg-red-500/10 text-xs font-mono text-red-300">
            SN
          </div>
          <div>
            <div className="font-mono text-sm font-bold text-white">SNIPER</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">15m Tactical</div>
          </div>
        </div>
      </div>

      {NAV.map(group => (
        <div key={group.section} className="mb-6">
          <div className="mb-2 px-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            {group.section}
          </div>
          <div className="space-y-1">
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "block rounded px-3 py-2 text-xs font-mono transition-colors",
                  isActive(pathname, item.href)
                    ? "border-l-2 border-red-500 bg-red-500/10 text-red-400"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white",
                ].join(" ")}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="absolute bottom-4 px-2 font-mono text-[10px] text-slate-600">
        APEX SNIPER 15m/1h
      </div>
    </aside>
  );
}

