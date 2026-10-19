"use client";

import { useId, useState } from "react";

export function Tooltip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs font-semibold text-muted"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        i
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-8 z-20 w-64 -translate-x-1/2 rounded-2xl bg-ink px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-card"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
