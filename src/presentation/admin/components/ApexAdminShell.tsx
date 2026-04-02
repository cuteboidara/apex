"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";

type IconProps = {
  className?: string;
};

type AdminNavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => ReactElement;
};

function LayoutDashboardIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />
    </svg>
  );
}

function UsersIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a3 3 0 0 1 0 5.74" />
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

function BarChart2Icon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  );
}

function FlaskIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3" />
      <path d="M8 14h8" />
    </svg>
  );
}

function ClipboardListIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 3h6v4H9zM9 12h6M9 16h4" />
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

function SettingsIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V22a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H2a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H22a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  );
}

function SendIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
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

const PRIMARY_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/signals", label: "Signals", icon: RadioIcon },
  { href: "/admin/assets", label: "Assets", icon: BarChart2Icon },
  { href: "/admin/daily-runs", label: "Daily Runs", icon: ClipboardListIcon },
  { href: "/admin/backtests", label: "Backtests", icon: FlaskIcon },
  { href: "/admin/execution", label: "Execution", icon: CpuIcon },
  { href: "/admin/system", label: "System", icon: SettingsIcon },
  { href: "/admin/telegram", label: "Telegram", icon: SendIcon },
];

const OBSERVABILITY_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin/risk-shadow", label: "Shadow Risk", icon: ClipboardListIcon },
  { href: "/admin/risk-rules", label: "Rule Distribution", icon: BarChart2Icon },
  { href: "/admin/data-quality", label: "Data Quality", icon: CpuIcon },
  { href: "/admin/conversion", label: "Conversion Rates", icon: FlaskIcon },
];

function getSessionLabel(date: Date) {
  const hour = date.getUTCHours();

  if (hour >= 6 && hour < 12) return "LONDON SESSION";
  if (hour >= 12 && hour < 16) return "LONDON / NEW YORK";
  if (hour >= 16 && hour < 21) return "NEW YORK SESSION";
  if (hour >= 0 && hour < 6) return "ASIA SESSION";
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
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ApexAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const email = session?.user?.email ?? "admin";

  return (
    <div className="apex-shell md:flex md:min-h-screen">
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
            <p className="apex-sidebar-brand-caption">Admin Control</p>
          </div>
        </div>

        <nav className="apex-sidebar-nav flex-1">
          {PRIMARY_NAV_ITEMS.map((item, index) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
                className="apex-sidebar-nav-link apex-slide-in text-[13px] transition-all"
                style={{
                  animationDelay: `${index * 60}ms`,
                  fontFamily: "var(--apex-font-body)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon className={`relative z-[1] h-4 w-4 ${active ? "text-[var(--apex-text-primary)]" : "text-[var(--apex-text-tertiary)]"}`} />
                <span className="relative z-[1]">{item.label}</span>
              </Link>
            );
          })}

          <div className="px-3 pb-2 pt-5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--apex-text-tertiary)]">
            Observability
          </div>

          {OBSERVABILITY_NAV_ITEMS.map((item, index) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
                className="apex-sidebar-nav-link apex-slide-in text-[13px] transition-all"
                style={{
                  animationDelay: `${(PRIMARY_NAV_ITEMS.length + index) * 60}ms`,
                  fontFamily: "var(--apex-font-body)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon className={`relative z-[1] h-4 w-4 ${active ? "text-[var(--apex-text-primary)]" : "text-[var(--apex-text-tertiary)]"}`} />
                <span className="relative z-[1]">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="apex-sidebar-footer mt-auto">
          <div className="mb-1 flex items-center gap-[6px]">
            <div className="apex-pulse-dot" style={{ width: "6px", height: "6px", borderRadius: "9999px", background: "var(--apex-text-accent)" }} />
            <span className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.08em] text-[var(--apex-text-accent)]">ADMIN ONLINE</span>
          </div>
          <p className="font-[var(--apex-font-mono)] text-[10px] tracking-[0.06em] text-[var(--apex-text-tertiary)]">
            {getSessionLabel(now)}
          </p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            {formatUtcTime(now)} UTC
          </p>
        </div>
      </aside>

      <main className="apex-main-region min-w-0 flex-1 overflow-x-hidden px-5 pb-12 pt-20 md:px-10 md:pb-14 md:pt-10 xl:px-12">
        <header className="apex-page-header">
          <div>
            <h1 className="apex-page-title">Admin Control</h1>
            <p className="apex-page-subtitle">Runtime operations, visibility, and intervention controls.</p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <Chip label="admin surface" variant="active" />
            <div className="flex items-center gap-3">
              <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                {email}
              </p>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                className="apex-link-button"
              >
                Sign Out
              </button>
            </div>
          </div>
        </header>
        <div className="space-y-8">{children}</div>
      </main>
    </div>
  );
}
