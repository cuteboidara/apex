"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    section: "SCALP",
    items: [
      { label: "Live Signals", href: "/scalp" },
      { label: "Gates Monitor", href: "/scalp/gates" },
      { label: "Diagnostics", href: "/scalp/diagnostics" },
      { label: "History", href: "/scalp/history" },
      { label: "Performance", href: "/scalp/stats" },
    ],
  },
  {
    section: "SWITCH",
    items: [
      { label: "Swing", href: "/indices-v2" },
      { label: "Sniper", href: "/sniper" },
    ],
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/scalp") return pathname === "/scalp";
  return pathname.startsWith(href);
}

export function ScalpSidebar() {
  const pathname = usePathname();

  return (
    <aside className="relative w-64 shrink-0 border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded border border-amber-500/40 bg-amber-500/10 text-xs font-mono text-amber-300">
            SC
          </div>
          <div>
            <div className="font-mono text-sm font-bold text-white">SCALP</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">5-Gate Confluence</div>
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
                    ? "border-l-2 border-amber-500 bg-amber-500/10 text-amber-400"
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
        APEX SCALP 15m/1h/4h
      </div>
    </aside>
  );
}
