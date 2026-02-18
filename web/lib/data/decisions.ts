import { computeDebt, computeHealthScore } from "../scoring";

export type Decision = {
  id: string;
  title: string;
  category: string;
  impact: number; // 1-5
  stress: number; // 1-5
  createdDate: string; // YYYY-MM-DD
  dueDate?: string | null; // YYYY-MM-DD
  resolvedDate?: string | null; // YYYY-MM-DD
};

export type DecisionComputed = Decision & {
  debt: number;
  daysOpen: number;
  overdueDays: number;
};

const STORAGE_KEY = "ddt.decisions.v1";

export function loadDecisions(): Decision[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Decision[];
  } catch {
    return [];
  }
}

export function saveDecisions(decisions: Decision[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
}

export function addDecision(decisions: Decision[], d: Omit<Decision, "id">): Decision[] {
  const id = crypto.randomUUID();
  const next: Decision = { id, ...d };
  return [next, ...decisions];
}

export function resolveDecision(decisions: Decision[], id: string): Decision[] {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  return decisions.map((d) => (d.id === id ? { ...d, resolvedDate: iso } : d));
}

export function computeAll(decisions: Decision[]): DecisionComputed[] {
  return decisions
    .filter((d) => !d.resolvedDate)
    .map((d) => {
      const b = computeDebt({
        createdDate: d.createdDate,
        dueDate: d.dueDate ?? null,
        impact: d.impact,
        stress: d.stress,
      });
      return { ...d, ...b };
    })
    .sort((a, b) => b.debt - a.debt);
}

export function computeSummary(active: DecisionComputed[]) {
  const totalDebt = active.reduce((acc, d) => acc + d.debt, 0);
  const avgDebt = active.length ? Math.round(totalDebt / active.length) : 0;
  const healthScore = computeHealthScore(totalDebt);
  return { totalDebt, avgDebt, healthScore };
}
