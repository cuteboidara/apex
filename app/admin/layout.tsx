"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_ITEMS = [
  { label: "OVERVIEW",  href: "/admin",          icon: "⬛" },
  { label: "USERS",     href: "/admin/users",     icon: "👤" },
  { label: "SIGNALS",   href: "/admin/signals",   icon: "📡" },
  { label: "ASSETS",    href: "/admin/assets",    icon: "📊" },
  { label: "SYSTEM",    href: "/admin/system",    icon: "⚙️" },
  { label: "TELEGRAM",  href: "/admin/telegram",  icon: "✈️" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "w-56" : "w-14"} flex-shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col transition-all duration-200`}
        style={{ minHeight: "100vh" }}
      >
        {/* Branding */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-zinc-800">
          <span className="text-lg font-bold" style={{ color: "#00ff88" }}>⬡</span>
          {sidebarOpen && (
            <span className="text-sm font-bold tracking-widest text-zinc-100">APEX ADMIN</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 flex flex-col gap-1">
          {NAV_ITEMS.map(item => {
            const active = item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors rounded mx-2 ${
                  active
                    ? "text-black"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                }`}
                style={active ? { backgroundColor: "#00ff88", color: "#000" } : {}}
              >
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span className="tracking-wide">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="px-4 py-3 border-t border-zinc-800 text-zinc-500 hover:text-zinc-300 text-xs text-left"
        >
          {sidebarOpen ? "◀ collapse" : "▶"}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-950">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-widest" style={{ color: "#00ff88" }}>APEX ADMIN</span>
            <span className="text-zinc-600 text-xs ml-2">Control Panel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500">emmadara229@gmail.com</span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-xs px-3 py-1.5 border border-zinc-700 rounded hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
