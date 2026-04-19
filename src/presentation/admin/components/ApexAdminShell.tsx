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

type AdminNavSection = {
  section: string;
  items: AdminNavItem[];
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

function UserCheckIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="m16.5 11.5 2 2 4-4" />
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

function ActivityIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12h4l2.5-6 5 12 2.5-6H21" />
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

const NAV_SECTIONS: AdminNavSection[] = [
  {
    section: "COMMAND",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
      { href: "/admin/signals", label: "Signals", icon: ZapIcon },
      { href: "/admin/assets", label: "Assets", icon: BarChart2Icon },
    ],
  },
  {
    section: "USERS",
    items: [
      { href: "/admin/users", label: "All Users", icon: UsersIcon },
      { href: "/admin/users/approvals", label: "Approvals", icon: UserCheckIcon },
    ],
  },
  {
    section: "SYSTEM",
    items: [
      { href: "/admin/system", label: "Runtime", icon: ActivityIcon },
      { href: "/admin/telegram", label: "Telegram", icon: SendIcon },
    ],
  },
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
  if (href === "/admin/users") {
    return pathname === "/admin/users" || (pathname.startsWith("/admin/users/") && !pathname.startsWith("/admin/users/approvals"));
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

        <nav className="apex-sidebar-nav flex-1 overflow-y-auto pr-1">
          <div className="space-y-6">
            {NAV_SECTIONS.map((section, sectionIndex) => (
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
                          animationDelay: `${animationIndex * 60}ms`,
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
