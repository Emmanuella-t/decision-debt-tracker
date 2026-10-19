"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../../lib/cn";

/** A button that shows and hides a section. `forceOpen` keeps it open, for example when it holds an error. */
export function Disclosure({
  label,
  children,
  forceOpen,
  defaultOpen,
  className,
}: {
  label: string;
  children: React.ReactNode;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const id = useId();
  const expanded = open || Boolean(forceOpen);
  return (
    <div className={cn("rounded-2xl border border-line", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-medium text-ink hover:bg-canvas"
      >
        {label}
        <ChevronDown className={cn("h-4 w-4 text-muted transition-transform duration-200", expanded && "rotate-180")} aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={id} className="grid gap-4 border-t border-line p-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
