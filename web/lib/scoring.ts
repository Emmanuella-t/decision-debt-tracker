export type DebtBreakdown = {
  debt: number; // 0-100
  daysOpen: number;
  overdueDays: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function daysBetween(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// A smooth compounding-ish curve that doesn’t explode:
// baseAge = 1 - exp(-daysOpen / 21)  (fast early growth then flattens)
function ageFactor(daysOpen: number) {
  return 1 - Math.exp(-daysOpen / 21);
}

// Overdue adds extra pressure but still bounded
function overdueBoost(overdueDays: number) {
  if (overdueDays <= 0) return 0;
  return 1 - Math.exp(-overdueDays / 14);
}

export function computeDebt(params: {
  createdDate: string; // YYYY-MM-DD
  dueDate?: string | null; // YYYY-MM-DD
  impact: number; // 1-5
  stress: number; // 1-5
  today?: Date;
}): DebtBreakdown {
  const today = params.today ?? new Date();

  const created = new Date(params.createdDate + "T00:00:00");
  const daysOpen = Math.max(0, daysBetween(created, today));

  const due = params.dueDate ? new Date(params.dueDate + "T00:00:00") : null;
  const overdueDays = due ? Math.max(0, daysBetween(due, today)) : 0;

  // Multipliers: impact & stress influence but don’t dominate
  const impactMult = 0.75 + params.impact * 0.10; // 0.85..1.25
  const stressMult = 0.75 + params.stress * 0.10; // 0.85..1.25

  const base = ageFactor(daysOpen); // 0..~1
  const overdue = overdueBoost(overdueDays); // 0..~1

  // Combine: base is the core; overdue accelerates if late
  // Weighted sum then scaled to 0..100
  const raw = (0.78 * base + 0.22 * overdue) * impactMult * stressMult;

  const debt = clamp(Math.round(raw * 100), 0, 100);

  return { debt, daysOpen, overdueDays };
}

export function computeHealthScore(totalDebt: number) {
  // Total debt can exceed 100, health should remain 0..100
  // Simple interpretation: 0 debt => 100 health, 400 debt => near 0
  const score = Math.round(100 * Math.exp(-totalDebt / 160));
  return clamp(score, 0, 100);
}
