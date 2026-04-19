"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

type IconProps = {
  className?: string;
};

type NavItem = {
  label: string;
  href: string;
  icon: (props: IconProps) => ReactElement;
};

type NavSection = {
  section: string;
  items: NavItem[];
};

function LayoutDashboardIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />
    </svg>
  );
}

function ZapIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

function TrendingUpIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

function BarChart2Icon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  );
}

function SettingsIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m14 3 1 2a7.4 7.4 0 0 1 2.5 1l2-1 1.5 2.5-1.8 1.3c.2.6.3 1.2.3 1.7l2 .8v3l-2 .8c0 .6-.1 1.1-.3 1.7l1.8 1.3L19.5 21l-2-1a7.4 7.4 0 0 1-2.5 1l-1 2h-3l-1-2a7.4 7.4 0 0 1-2.5-1l-2 1L3 18.5l1.8-1.3a7 7 0 0 1-.3-1.7l-2-.8v-3l2-.8c0-.6.1-1.1.3-1.7L3 7.5 4.5 5l2 1A7.4 7.4 0 0 1 9 5l1-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function MenuIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function LayersIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </svg>
  );
}

function GaugeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 14a9 9 0 1 1 18 0" />
      <path d="M12 14l4-4" />
      <circle cx="12" cy="14" r="1.2" />
    </svg>
  );
}

const navItems: NavSection[] = [
  {
    section: "Workspace",
    items: [
      { label: "Overview", icon: LayoutDashboardIcon, href: "/indices-v2" },
      { label: "FX", icon: TrendingUpIcon, href: "/indices-v2/fx" },
      { label: "Indices", icon: BarChart2Icon, href: "/indices-v2/indices" },
      { label: "Commodities", icon: LayersIcon, href: "/indices-v2/commodities" },
      { label: "Rates", icon: GaugeIcon, href: "/indices-v2/rates" },
      { label: "Macro", icon: ZapIcon, href: "/indices-v2/macro" },
      { label: "Correlations", icon: BarChart2Icon, href: "/indices-v2/correlations" },
      { label: "Controls", icon: SettingsIcon, href: "/indices-v2/controls" },
    ],
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/indices-v2") {
    return pathname === "/indices-v2" || pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatUtcTime(date: Date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

function getSessionLabel(date: Date) {
  const hour = date.getUTCHours();
  if (hour >= 6 && hour < 12) return "LONDON SESSION";
  if (hour >= 12 && hour < 16) return "LONDON / NEW YORK";
  if (hour >= 16 && hour < 21) return "NEW YORK SESSION";
  if (hour >= 0 && hour < 6) return "ASIA SESSION";
  return "OFF HOURS";
}

export function AMTSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        onClick={() => setMobileOpen(current => !current)}
        className="apex-mobile-toggle fixed left-5 top-5 z-[60] flex h-11 w-11 items-center justify-center rounded-[var(--apex-radius-md)] text-[var(--apex-text-primary)] md:hidden"
      >
        {mobileOpen ? <CloseIcon /> : <MenuIcon />}
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
          className="apex-overlay-backdrop fixed inset-0 z-40 md:hidden"
        />
      ) : null}

      <aside
        className={`apex-sidebar-shell fixed inset-y-0 left-0 z-50 flex h-screen flex-col transition-transform duration-200 md:sticky md:top-0 md:h-screen md:flex-none md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="apex-sidebar-brand">
          <div className="apex-sidebar-brand-mark">A</div>
          <div>
            <p className="apex-sidebar-brand-wordmark">APEX</p>
            <p className="apex-sidebar-brand-caption">AMT Trader Runtime</p>
          </div>
        </div>

        <nav className="apex-sidebar-nav flex-1 overflow-y-auto pr-1">
          <div className="space-y-6">
            {navItems.map((section, sectionIndex) => (
              <div key={section.section} className="space-y-2">
                <p className="px-1 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--apex-text-tertiary)]">
                  {section.section}
                </p>
                <div className="space-y-1">
                  {section.items.map((item, itemIndex) => {
                    const active = isActivePath(pathname, item.href);
                    const Icon = item.icon;
                    const animationIndex = sectionIndex * 8 + itemIndex;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-active={active}
                        className="apex-sidebar-nav-link apex-slide-in text-[13px] transition-all"
                        style={{
                          animationDelay: `${animationIndex * 45}ms`,
                          fontFamily: "var(--apex-font-body)",
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        <Icon className={`relative z-[1] h-4 w-4 ${active ? "text-[var(--apex-text-primary)]" : "text-[var(--apex-text-tertiary)]"}`} />
                        <span className="relative z-[1]">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="apex-sidebar-footer mt-auto">
          <div className="mb-1 flex items-center gap-[6px]">
            <div className="apex-pulse-dot h-[6px] w-[6px] rounded-full bg-[var(--accent-green)]" />
            <span className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.08em] text-[var(--accent-green)]">LIVE</span>
          </div>
          <p className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.06em] text-[var(--apex-text-tertiary)]">
            {getSessionLabel(now)}
          </p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            {formatUtcTime(now)} UTC
          </p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            AMT · NORMAL
          </p>
          <div className="mt-2 inline-flex rounded border border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 px-2 py-0.5 font-[var(--apex-font-mono)] text-[10px] text-[var(--accent-yellow)]">
            Paper Trading
          </div>
        </div>
      </aside>
    </>
  );
}
