"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { debtByDepartment, needsAttention, percentChange, priorSnapshot, summarize, trendReady } from "../../lib/analytics";
import { formatDisplayDate, localTodayISO, daypart } from "../../lib/dates";
import { useAppState } from "../providers/AppState";
import { DepartmentDonut } from "./DepartmentDonut";
import { TrendChart } from "./TrendChart";
import { Tooltip } from "../ui/Tooltip";
import { QuickStart } from "../decisions/QuickStart";

export function DashboardView() {
  const { ready, decisions, snapshots, preferences } = useAppState();
  const [wizardOpen, setWizardOpen] = useState(false);
  const today = localTodayISO();
  const summary = useMemo(() => summarize(decisions, new Date()), [decisions]);
  const attention = useMemo(() => needsAttention(summary.open, 3), [summary.open]);
  const departments = useMemo(() => debtByDepartment(summary.open), [summary.open]);
  const prior = priorSnapshot(snapshots, today, 30);
  const name = preferences.displayName.trim();
  const greeting = daypart();

  if (!ready) {
    return <p className="text-sm text-muted">Loading your decisions…</p>;
  }

  return (
    <div className="relative z-10 grid gap-4 pb-8 xl:pr-24">
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className="grid items-center lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.85fr)]">
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            {name ? (
              <h1 className="break-words text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Good {greeting}, {name}!
              </h1>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">Good {greeting}!</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ready to make progress?</h1>
              </>
            )}
            <p className="mt-3 max-w-md text-[15px] leading-6 text-muted">Let&apos;s move your decisions forward.</p>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-teal px-5 text-sm font-semibold text-white transition-colors duration-200 ease-soft hover:bg-[#14685f]"
            >
              <Plus size={16} aria-hidden="true" />
              Add Decision
            </button>
          </div>
          <div className="relative min-h-[180px] overflow-hidden lg:min-h-full">
            <Link
              href="/settings"
              aria-label="Display name and settings"
              className="absolute right-4 top-4 z-10 inline-flex rounded-2xl lg:right-6 lg:top-5"
            >
              <Image src="/brand/ddt-image8.png" alt="" width={52} height={52} className="h-[52px] w-[52px] object-contain" />
            </Link>
            <Image
              src="/brand/ddt-image3.png"
              alt=""
              width={520}
              height={360}
              priority
              className="pointer-events-none absolute -bottom-10 right-0 h-[320px] w-auto max-w-none object-contain"
            />
          </div>
        </div>
      </section>

      <section aria-label="Summary" className="grid gap-4 md:grid-cols-3">
        <Kpi
          image="/brand/ddt-image6.png"
          label="Total Decision Debt"
          value={summary.totalDebt}
          tooltip="The sum of decision-debt scores for decisions that are still open. Resolved decisions are not included. Each score runs from 0 to 100."
          change={prior ? percentChange(summary.totalDebt, prior.totalDebt) : null}
          comparisonDate={prior?.date}
        />
        <Kpi
          image="/brand/ddt-image5.png"
          label="Open Decisions"
          value={summary.openCount}
          change={prior ? percentChange(summary.openCount, prior.openCount) : null}
          comparisonDate={prior?.date}
        />
        <Kpi
          image="/brand/ddt-image7.png"
          label="Overdue Decisions"
          value={summary.overdueCount}
          change={prior ? percentChange(summary.overdueCount, prior.overdueCount) : null}
          comparisonDate={prior?.date}
        />
      </section>
      {summary.unscorableCount > 0 ? (
        <p className="text-sm text-warning-text" role="status">
          {summary.unscorableCount} saved decision{summary.unscorableCount === 1 ? "" : "s"} could not be scored and {summary.unscorableCount === 1 ? "is" : "are"} excluded from these totals.
        </p>
      ) : null}
      {summary.unratedCount > 0 ? (
        <p className="text-sm text-muted" role="status">
          {summary.unratedCount} open decision{summary.unratedCount === 1 ? " isn't" : "s aren't"} rated yet, so {summary.unratedCount === 1 ? "it's" : "they're"} not in the debt total.
        </p>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <article className="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-semibold">Decision Debt Trend</h2>
          <div className="mt-4">
            {trendReady(snapshots) ? (
              <TrendChart snapshots={snapshots} />
            ) : (
              <p className="rounded-2xl bg-canvas px-4 py-10 text-center text-sm leading-6 text-muted">
                Decision debt trends will appear once historical tracking data becomes available.
                <span className="mt-2 block">A snapshot is saved each day you use the app. A trend needs at least two different days.</span>
              </p>
            )}
          </div>
        </article>
        <article className="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-semibold">Decision Debt by Department</h2>
          <div className="mt-4">
            {departments.hasDepartmentData ? (
              <DepartmentDonut totalDebt={departments.totalDebt} segments={departments.segments} />
            ) : (
              <p className="rounded-2xl bg-canvas px-4 py-10 text-center text-sm leading-6 text-muted">
                {summary.openCount === 0
                  ? "Department shares will appear when you have unresolved decisions with a debt score."
                  : departments.totalDebt === 0
                    ? "Open decisions are here, but their debt scores are still zero, so there is nothing to split by department."
                    : "Add a department to an open decision to see how unresolved debt is split. Department is stored in this browser and is not part of the command-line database yet."}
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <article className="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Needs Attention</h2>
            <Link href="/decisions" className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-ink">
              View all <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted">Sorted by overdue time, then debt score, then impact, then soonest due date.</p>
          {attention.length === 0 ? (
            <p className="mt-6 text-sm leading-6 text-muted">Nothing needs attention right now. Add a decision to start tracking.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {attention.map((decision) => (
                <li key={decision.id}>
                  <Link href={`/decisions/${decision.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl py-3 hover:bg-canvas">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{decision.title}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {decision.department || decision.category}
                        <Urgency decision={decision} />
                      </span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {wizardOpen ? <QuickStart onClose={() => setWizardOpen(false)} /> : null}
    </div>
  );
}

function Urgency({ decision }: { decision: { overdueDays: number; dueDate: string | null; daysOpen: number } }) {
  if (decision.overdueDays > 0) {
    return <span className="text-warning-text"> · Overdue by {decision.overdueDays} days</span>;
  }
  if (decision.dueDate) {
    return <span> · Due {formatDisplayDate(decision.dueDate)}</span>;
  }
  return <span> · Open {decision.daysOpen === 1 ? "1 day" : `${decision.daysOpen} days`}</span>;
}

function Kpi({
  image,
  label,
  value,
  tooltip,
  change,
  comparisonDate,
}: {
  image: string;
  label: string;
  value: number;
  tooltip?: string;
  change: number | null;
  comparisonDate?: string;
}) {
  return (
    <article className="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-4 shadow-card">
      <Image src={image} alt="" width={72} height={72} className="h-[72px] w-[72px] shrink-0 object-contain" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm text-muted">{label}</h2>
          {tooltip ? <Tooltip label={`About ${label}`} text={tooltip} /> : null}
        </div>
        <p className="mt-1 text-4xl font-semibold tabular-nums leading-none tracking-tight">{value}</p>
        {change !== null && comparisonDate ? (
          <p className={`mt-2 text-xs font-medium ${change > 0 ? "text-warning-text" : "text-teal"}`}>
            {change > 0 ? "+" : ""}
            {change}% vs {formatDisplayDate(comparisonDate)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
