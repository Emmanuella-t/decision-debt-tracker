"use client";

import Image from "next/image";
import { AppStateProvider, useAppState } from "../providers/AppState";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppStateProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col lg:flex-row lg:gap-5 lg:px-5 lg:py-5">
        <Sidebar />
        <div className="relative min-w-0 flex-1 px-4 py-4 lg:px-0 lg:py-0">
          <Notice />
          <div id="main">{children}</div>
        </div>
      </div>
      {/* Pinned to the viewport bottom and sized to fit the pages' xl:pr-24 gutter, so it never sits over content. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 z-0 hidden xl:block">
        <div className="mx-auto flex w-full max-w-[1440px] justify-end px-1">
          <Image src="/brand/ddt-image4.png" alt="" width={220} height={280} className="h-auto w-[110px]" />
        </div>
      </div>
    </AppStateProvider>
  );
}

function Notice() {
  const { notice, dismissNotice } = useAppState();
  if (!notice) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-soft" role="status">
      <p>{notice}</p>
      <button type="button" className="min-h-11 rounded-xl px-3 text-muted" onClick={dismissNotice}>
        Dismiss
      </button>
    </div>
  );
}
