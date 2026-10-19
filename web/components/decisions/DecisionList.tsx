"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { summarize } from "../../lib/analytics";
import { STAGE_LABELS } from "../../lib/blockers";
import { activeBlockers, isBlocked, isValidRecord, withDebt } from "../../lib/data/decisions";
import { formatDisplayDate } from "../../lib/dates";
import { useAppState } from "../providers/AppState";
import { QuickStart } from "./QuickStart";

export function DecisionList() {
  const { ready, decisions } = useAppState();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const summary = useMemo(() => summarize(decisions, new Date()), [decisions]);

  const rows = decisions
    .filter((decision) => {
      if (filter === "open") return !decision.resolvedDate;
      if (filter === "resolved") return Boolean(decision.resolvedDate);
      return true;
    })
    .filter((decision) => {
      const haystack = [
        decision.title,
        decision.category,
        decision.department ?? "",
        decision.owner,
        ...decision.blockedWork.map((item) => item.title),
        ...activeBlockers(decision).map((blocker) => blocker.description),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    })
    .map((decision) => ({
      decision,
      score: isValidRecord(decision) ? withDebt(decision, new Date()) : null,
    }));

  if (!ready) return <p className="text-sm text-muted">Loading decisions…</p>;

  return (
    <div className="relative z-10 grid gap-4 pb-16 xl:pr-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Decisions</h1>
          <p className="mt-1 text-sm text-muted">
            {summary.openCount} open · {decisions.filter((decision) => decision.resolvedDate).length} resolved
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full bg-teal px-5 text-sm font-semibold text-white"
        >
          Add Decision
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">Search decisions</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, owners, blockers, or waiting work"
            className="w-full rounded-2xl border border-line bg-surface px-4 py-3"
          />
        </label>
        <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Filter decisions">
          {(["open", "resolved", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`min-h-11 rounded-full px-4 text-sm capitalize ${filter === value ? "bg-teal-soft font-semibold text-ink" : "text-muted"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-5 py-10 text-center text-sm text-muted shadow-card">
          {decisions.length === 0 ? "No decisions yet. Add one to start tracking debt." : "No decisions match this view."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map(({ decision, score }) => (
            <li key={decision.id}>
              <Link
                href={`/decisions/${decision.id}`}
                className="block rounded-card border border-line bg-surface px-5 py-4 shadow-soft hover:border-teal/40"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-semibold">{decision.title}</span>
                  <span className="tabular-nums text-sm text-muted">{score && score.scored ? `${score.debt} debt` : "Not scored"}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span className="rounded-full bg-canvas px-2.5 py-0.5 font-medium text-ink">{STAGE_LABELS[decision.stage]}</span>
                  {isBlocked(decision) ? (
                    <span className="rounded-full bg-[#fff6ee] px-2.5 py-0.5 font-medium text-warning-text">
                      Blocked · {activeBlockers(decision).length}
                    </span>
                  ) : null}
                  <span>
                    {[decision.department || decision.category, decision.resolvedDate ? `Resolved ${formatDisplayDate(decision.resolvedDate)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {score && score.overdueDays > 0 && !decision.resolvedDate ? ` · Overdue by ${score.overdueDays} days` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {wizardOpen ? <QuickStart onClose={() => setWizardOpen(false)} /> : null}
    </div>
  );
}
