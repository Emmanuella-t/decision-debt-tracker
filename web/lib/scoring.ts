import { diffISODays, localTodayISO } from "./dates";

export type DebtBreakdown = {
  debt: number;
  daysOpen: number;
  overdueDays: number;
  invalid: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Web debt score, 0–100. This is the formula already used by the web app.
 * Do not retune it here.
 *
 * The Python CLI uses a different formula (severity × growth × overdue boost,
 * health divisor 200). See the Settings page for the difference. A later
 * milestone should make the CLI formula authoritative and show the score
 * change before migrating saved records.
 *
 * Day counts use calendar dates so a daylight-saving transition cannot drop
 * a day. The curve itself is unchanged.
 */
function ageFactor(daysOpen: number) {
  return 1 - Math.exp(-daysOpen / 21);
}

function overdueBoost(overdueDays: number) {
  if (overdueDays <= 0) return 0;
  return 1 - Math.exp(-overdueDays / 14);
}

export function computeDebt(params: {
  createdDate: string;
  dueDate?: string | null;
  impact: number;
  stress: number;
  today?: Date;
}): DebtBreakdown {
  const todayISO = localTodayISO(params.today ?? new Date());
  const openSpan = diffISODays(params.createdDate, todayISO);
  const ratingsInvalid =
    !Number.isInteger(params.impact) ||
    !Number.isInteger(params.stress) ||
    params.impact < 1 ||
    params.impact > 5 ||
    params.stress < 1 ||
    params.stress > 5;

  if (openSpan === null || ratingsInvalid) {
    return { debt: 0, daysOpen: 0, overdueDays: 0, invalid: true };
  }

  const daysOpen = Math.max(0, openSpan);
  const dueSpan = params.dueDate ? diffISODays(params.dueDate, todayISO) : 0;
  const overdueDays = dueSpan === null ? 0 : Math.max(0, dueSpan);

  const impactMult = 0.75 + params.impact * 0.1;
  const stressMult = 0.75 + params.stress * 0.1;
  const base = ageFactor(daysOpen);
  const overdue = overdueBoost(overdueDays);
  const raw = (0.78 * base + 0.22 * overdue) * impactMult * stressMult;
  const debt = clamp(Math.round(raw * 100), 0, 100);

  return { debt, daysOpen, overdueDays, invalid: dueSpan === null && Boolean(params.dueDate) };
}

export function computeHealthScore(totalDebt: number) {
  if (!Number.isFinite(totalDebt) || totalDebt < 0) return 100;
  const score = Math.round(100 * Math.exp(-totalDebt / 160));
  return clamp(score, 0, 100);
}
