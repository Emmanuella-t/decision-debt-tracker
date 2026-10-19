"use client";

import { useMemo } from "react";
import { categoryDebt, summarize, trendReady } from "../../lib/analytics";
import { useAppState } from "../../components/providers/AppState";
import { TrendChart } from "../../components/dashboard/TrendChart";

export default function InsightsPage() {
  const { ready, decisions, snapshots } = useAppState();
  const summary = useMemo(() => summarize(decisions, new Date()), [decisions]);
  const categories = useMemo(() => categoryDebt(summary.open), [summary.open]);
  const resolved = decisions.filter((decision) => decision.resolvedDate).length;

  if (!ready) return <p className="text-sm text-muted">Loading insights…</p>;

  return (
    <div className="relative z-10 grid gap-4 pb-16 xl:pr-24">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          These figures use the web scoring curve and only include decisions saved in this browser. Resolved decisions are left out of current debt.
        </p>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm text-muted">Decision health</h2>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{summary.healthScore}</p>
          <p className="mt-2 text-xs leading-5 text-muted">Out of 100. Higher means less open debt. This uses the web formula, which is not the same as the command-line score.</p>
        </article>
        <article className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm text-muted">Average open debt</h2>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{summary.averageDebt}</p>
          <p className="mt-2 text-xs leading-5 text-muted">Average score across {summary.openCount} open {summary.openCount === 1 ? "decision" : "decisions"}.</p>
        </article>
        <article className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm text-muted">Resolved</h2>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{resolved}</p>
          <p className="mt-2 text-xs leading-5 text-muted">Kept for history. They do not add to current debt.</p>
        </article>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold">Debt by category</h2>
        {categories.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Category totals will appear when an open decision has a debt score.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <caption className="sr-only">Unresolved debt and decision counts by category</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium">Open decisions</th>
                <th className="py-2 font-medium">Debt points</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={row.category} className="border-b border-line last:border-0">
                  <td className="py-3">{row.category}</td>
                  <td className="py-3 tabular-nums">{row.count}</td>
                  <td className="py-3 tabular-nums">{row.debt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold">Recorded trend</h2>
        <div className="mt-4">
          {trendReady(snapshots) ? (
            <TrendChart snapshots={snapshots} />
          ) : (
            <p className="text-sm leading-6 text-muted">Decision debt trends will appear once historical tracking data becomes available.</p>
          )}
        </div>
      </section>
    </div>
  );
}
