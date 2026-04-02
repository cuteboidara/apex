"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import type { RecoveryMode } from "@/src/interfaces/contracts";

type IconProps = {
  className?: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => ReactElement;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function LayoutGridIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
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

function BitcoinIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 4v16M15 4v16M7 7h6a3 3 0 1 1 0 6H7h7a3 3 0 1 1 0 6H7" />
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

function LayersIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </svg>
  );
}

function GlobeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
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

function RadioIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BookOpenIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v18H5.5A2.5 2.5 0 0 0 3 23zM21 5.5A2.5 2.5 0 0 0 18.5 3H13v18h5.5A2.5 2.5 0 0 1 21 23z" />
    </svg>
  );
}

function LayoutDashboardIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />
    </svg>
  );
}

function LightbulbIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12c1 1 2 2.5 2 4h4c0-1.5 1-3 2-4a7 7 0 0 0-4-12Z" />
    </svg>
  );
}

function FlaskConicalIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 3v6l-5 8.5A2.6 2.6 0 0 0 7.3 21h9.4A2.6 2.6 0 0 0 19 17.5L14 9V3" />
      <path d="M9 3h6M8 14h8" />
    </svg>
  );
}

function ShieldIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6l7-3Z" />
    </svg>
  );
}

function CpuIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8 7 17M17 7l2.8-2.8" />
    </svg>
  );
}

function KeyRoundIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10.5 13 21 2.5M15 6h3v3M18 3h3v3" />
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

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Markets",
    items: [
      { icon: LayoutGridIcon, label: "Markets", href: "/markets" },
      { icon: TrendingUpIcon, label: "Forex", href: "/forex" },
      { icon: BitcoinIcon, label: "Crypto", href: "/crypto" },
      { icon: BarChart2Icon, label: "Stocks", href: "/stocks" },
      { icon: LayersIcon, label: "Commodities", href: "/commodities" },
      { icon: GlobeIcon, label: "Indices", href: "/indices" },
      { icon: ZapIcon, label: "Meme Coins", href: "/memecoins" },
    ],
  },
  {
    label: "Signals",
    items: [
      { icon: RadioIcon, label: "All Signals", href: "/signals" },
      { icon: BookOpenIcon, label: "Journal", href: "/journal" },
    ],
  },
  {
    label: "System",
    items: [
      { icon: LayoutDashboardIcon, label: "Overview", href: "/" },
      { icon: BarChart2Icon, label: "Quality", href: "/quality" },
      { icon: LightbulbIcon, label: "Recommendations", href: "/recommendations" },
      { icon: FlaskConicalIcon, label: "Validation", href: "/validation" },
      { icon: ShieldIcon, label: "Risk", href: "/risk" },
      { icon: CpuIcon, label: "Pods", href: "/pods" },
      { icon: KeyRoundIcon, label: "Account", href: "/account" },
    ],
  },
];

function getSessionLabel(date: Date) {
  const hour = date.getUTCHours();

  if (hour >= 6 && hour < 12) {
    return "LONDON SESSION";
  }
  if (hour >= 12 && hour < 16) {
    return "LONDON / NEW YORK";
  }
  if (hour >= 16 && hour < 21) {
    return "NEW YORK SESSION";
  }
  if (hour >= 0 && hour < 6) {
    return "ASIA SESSION";
  }
  return "OFF HOURS";
}

function formatUtcTime(date: Date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ApexSidebar({
  mode,
}: {
  mode: RecoveryMode;
}) {
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
            <p className="apex-sidebar-brand-caption">Trader Runtime</p>
          </div>
        </div>

        <nav className="apex-sidebar-nav flex-1 overflow-y-auto pr-1">
          <div className="space-y-6">
            {NAV_SECTIONS.map((section, sectionIndex) => (
              <div key={section.label} className="space-y-2">
                <p className="px-1 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--apex-text-tertiary)]">
                  {section.label}
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
            <div className="apex-pulse-dot" style={{ width: "6px", height: "6px", borderRadius: "9999px", background: "var(--apex-text-accent)" }} />
            <span className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.08em] text-[var(--apex-text-accent)]">LIVE</span>
          </div>
          <p className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.06em] text-[var(--apex-text-tertiary)]">
            {getSessionLabel(now)}
          </p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            {formatUtcTime(now)} UTC
          </p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            {mode.replaceAll("_", " ")}
          </p>
        </div>
      </aside>
    </>
  );
}
