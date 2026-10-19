import { DEPARTMENT_COLORS } from "./constants";
import { isValidRecord, withDebt, type DecisionComputed } from "./data/decisions";
import type { Decision, Snapshot } from "./types";
import { addISODays, compareISODate } from "./dates";
import { computeHealthScore } from "./scoring";

export type Summary = {
  open: DecisionComputed[];
  openCount: number;
  overdueCount: number;
  totalDebt: number;
  averageDebt: number;
  healthScore: number;
  /** Open records whose dates or ratings can't be read. Excluded from every count. */
  unscorableCount: number;
  /** Open decisions without impact and stress yet. Counted as open, but not in debt totals. */
  unratedCount: number;
};

export function summarize(decisions: Decision[], today: Date): Summary {
  const openRecords = decisions.filter((decision) => !decision.resolvedDate);
  const unscorableCount = openRecords.filter((decision) => !isValidRecord(decision)).length;
  const open = openRecords
    .filter(isValidRecord)
    .map((decision) => withDebt(decision, today))
    .sort((a, b) => Number(b.scored) - Number(a.scored) || b.debt - a.debt || b.overdueDays - a.overdueDays || a.id.localeCompare(b.id));
  const scored = open.filter((decision) => decision.scored);
  const totalDebt = scored.reduce((sum, decision) => sum + decision.debt, 0);
  const overdueCount = open.filter((decision) => decision.overdueDays > 0).length;
  const averageDebt = scored.length ? Math.round(totalDebt / scored.length) : 0;
  return {
    open,
    openCount: open.length,
    overdueCount,
    totalDebt,
    averageDebt,
    healthScore: computeHealthScore(totalDebt),
    unscorableCount,
    unratedCount: open.length - scored.length,
  };
}

/**
 * Overdue time, then debt score, then impact, then the soonest due date.
 * Only fields the app already stores are used.
 */
export function needsAttention(open: DecisionComputed[], limit = 3): DecisionComputed[] {
  return [...open]
    .sort((a, b) => {
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
      if (b.debt !== a.debt) return b.debt - a.debt;
      if ((b.impact ?? 0) !== (a.impact ?? 0)) return (b.impact ?? 0) - (a.impact ?? 0);
      const aDue = a.dueDate ?? "9999-99-99";
      const bDue = b.dueDate ?? "9999-99-99";
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export type DepartmentSegment = {
  department: string;
  debt: number;
  share: number;
  color: string;
};

export function debtByDepartment(open: DecisionComputed[]): {
  totalDebt: number;
  segments: DepartmentSegment[];
  hasDepartmentData: boolean;
} {
  const totalDebt = open.reduce((sum, decision) => sum + decision.debt, 0);
  if (totalDebt <= 0) return { totalDebt, segments: [], hasDepartmentData: false };

  const buckets = new Map<string, number>();
  for (const decision of open) {
    if (!decision.scored) continue;
    const key = decision.department?.trim() || "Not assigned";
    buckets.set(key, (buckets.get(key) ?? 0) + decision.debt);
  }

  const assigned = [...buckets.entries()].filter(([name]) => name !== "Not assigned");
  if (assigned.length === 0) {
    return { totalDebt, segments: [], hasDepartmentData: false };
  }

  const segments = [...buckets.entries()]
    .map(([department, debt]) => ({
      department,
      debt,
      share: debt / totalDebt,
      color: DEPARTMENT_COLORS[department] ?? "#8AA0A6",
    }))
    .sort((a, b) => b.debt - a.debt || a.department.localeCompare(b.department));

  return { totalDebt, segments, hasDepartmentData: true };
}

export function upsertSnapshot(snapshots: Snapshot[], next: Snapshot): Snapshot[] {
  const rest = snapshots.filter((snapshot) => snapshot.date !== next.date);
  return [...rest, next].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function trendReady(snapshots: Snapshot[]): boolean {
  return new Set(snapshots.map((snapshot) => snapshot.date)).size >= 2;
}

export function priorSnapshot(snapshots: Snapshot[], today: string, days = 30): Snapshot | null {
  const target = addISODays(today, -days);
  if (!target) return null;
  const candidates = snapshots.filter((snapshot) => compareISODate(snapshot.date, target) !== 1);
  if (!candidates.length) return null;
  return candidates[candidates.length - 1];
}

/** Null when the earlier value is zero, so we never imply a percentage from nothing. */
export function percentChange(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

export function categoryDebt(open: DecisionComputed[]): { category: string; debt: number; count: number }[] {
  const buckets = new Map<string, { debt: number; count: number }>();
  for (const decision of open) {
    const key = decision.category.trim() || "Uncategorized";
    const current = buckets.get(key) ?? { debt: 0, count: 0 };
    current.debt += decision.debt;
    current.count += 1;
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.debt - a.debt || a.category.localeCompare(b.category));
}
