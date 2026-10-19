"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, LayoutDashboard, Menu, Settings, X } from "lucide-react";
import { cn } from "../../lib/cn";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-1">
      {links.map((link) => {
        const active = pathname === link.href || (link.href === "/dashboard" && pathname === "/");
        const Icon = link.icon;
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors duration-200 ease-soft",
                active ? "bg-teal-soft text-ink" : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              <Icon size={18} aria-hidden="true" className={active ? "text-teal" : "text-muted"} />
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-line bg-surface"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu size={18} aria-hidden="true" />
          <span className="sr-only">Open navigation</span>
        </button>
        <p className="text-sm font-semibold">Decision Debt Tracker</p>
        <Link href="/settings" className="inline-flex min-h-11 min-w-11 items-center justify-center" aria-label="Settings">
          <Image src="/brand/ddt-image8.png" alt="" width={40} height={40} />
        </Link>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div id="mobile-navigation" className="relative h-full w-[min(100%,320px)] bg-surface p-5 shadow-card">
            <div className="mb-6 flex items-center justify-between">
              <BrandLockup />
              <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
                <span className="sr-only">Close navigation</span>
              </button>
            </div>
            <nav aria-label="Primary">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}

      <aside className="relative hidden w-[232px] shrink-0 lg:block">
        <div className="sticky top-5 flex min-h-[calc(100vh-2.5rem)] flex-col overflow-visible rounded-card border border-line bg-surface px-4 py-5 shadow-card">
          <BrandLockup />
          <nav aria-label="Primary" className="relative z-10 mt-8">
            <NavLinks />
          </nav>
          <div className="pointer-events-none relative z-0 mt-auto hidden min-[1180px]:block" aria-hidden="true">
            <Image
              src="/brand/ddt-image2.png"
              alt=""
              width={220}
              height={275}
              className="h-auto w-[190px] max-w-none -translate-x-6"
            />
          </div>
        </div>
      </aside>
    </>
  );
}

function BrandLockup() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 rounded-2xl">
      <Image src="/brand/ddt-image1.png" alt="" width={64} height={64} priority className="h-14 w-14 object-contain" />
      <span className="text-[15px] font-semibold leading-5 tracking-tight text-ink">
        Decision Debt
        <br />
        Tracker
      </span>
    </Link>
  );
}
