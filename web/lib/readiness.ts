import { blockerGuide } from "./blockers";
import type { Blocker, Decision } from "./types";

/**
 * Readiness says whether the known blockers, information, and steps look
 * addressed enough to consider deciding. It is separate from the debt score,
 * is derived from saved records every time, and never changes them.
 */
export type ReadinessState = "information_needed" | "working_through_blockers" | "ready_for_review" | "ready_to_decide";

export type Readiness = {
  state: ReadinessState;
  label: string;
  reasons: string[];
  /** The person noted it's ready despite open items. The open items are still listed. */
  override: string | null;
};

export const READINESS_LABELS: Record<ReadinessState, string> = {
  information_needed: "Information needed",
  working_through_blockers: "Working through blockers",
  ready_for_review: "Ready for review",
  ready_to_decide: "Ready to decide",
};

type Input = Pick<Decision, "blockers" | "actions" | "evidence" | "resolvedDate" | "readinessOverride">;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Short names for blockers, by type, numbered when a type repeats. Descriptions stay in the detail view. */
export function blockerLabels(blockers: Pick<Blocker, "id" | "type">[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const blocker of blockers) totals.set(blocker.type, (totals.get(blocker.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const blocker of blockers) {
    const count = (seen.get(blocker.type) ?? 0) + 1;
    seen.set(blocker.type, count);
    const label = blockerGuide(blocker.type).label;
    labels.set(blocker.id, (totals.get(blocker.type) ?? 0) > 1 ? `${label} (${count})` : label);
  }
  return labels;
}

/** What still stands between this blocker and checking its clearing criteria. */
export function blockerOpenItems(decision: Input, blocker: Blocker): string[] {
  const items: string[] = [];
  const actions = decision.actions.filter((action) => action.blockerId === blocker.id);
  const evidence = decision.evidence.filter((item) => item.blockerId === blocker.id);
  const openActions = actions.filter((action) => !action.done).length;
  if (!blocker.description.trim()) items.push("It isn't described yet.");
  if (!blocker.resolvesWhen.trim()) items.push("No clearing criteria are written down.");
  if (actions.length === 0 && evidence.length === 0) items.push("No step or evidence is linked yet.");
  if (openActions > 0) items.push(`${plural(openActions, "linked step is", "linked steps are")} unfinished.`);
  if (blocker.unknowns.length > 0) items.push(`${plural(blocker.unknowns.length, "question is", "questions are")} marked not known yet.`);
  if (blocker.type === "missing_information" && !evidence.some((item) => item.status === "reviewed")) {
    items.push("No reviewed evidence is recorded for this information gap.");
  }
  const challenged = evidence.filter((item) => item.status === "challenged").length;
  if (challenged > 0) items.push(`${plural(challenged, "evidence entry is", "evidence entries are")} challenged.`);
  const openQuestions = evidence.filter((item) => !item.summary.trim()).length;
  if (openQuestions > 0) items.push(`${plural(openQuestions, "research question has", "research questions have")} no finding yet.`);
  return items;
}

export function deriveReadiness(decision: Input): Readiness | null {
  if (decision.resolvedDate) return null;
  const active = decision.blockers.filter((blocker) => blocker.status === "active");
  const reasons: string[] = [];
  let state: ReadinessState;

  if (active.length > 0) {
    const pending = active.map((blocker) => ({ blocker, items: blockerOpenItems(decision, blocker) }));
    const stillOpen = pending.filter((entry) => entry.items.length > 0);
    const infoGaps = stillOpen.filter(
      (entry) => entry.blocker.type === "missing_information" || entry.blocker.type === "unknown" || entry.blocker.unknowns.length > 0,
    );
    if (stillOpen.length === 0) {
      state = "ready_for_review";
      reasons.push(
        `Work on ${plural(active.length, "active blocker", "active blockers")} looks finished. Check the clearing criteria before clearing ${active.length === 1 ? "it" : "them"}.`,
      );
    } else if (infoGaps.length > 0) {
      state = "information_needed";
      reasons.push(`${plural(infoGaps.length, "active information gap still needs", "active information gaps still need")} work.`);
    } else {
      state = "working_through_blockers";
      reasons.push(`${plural(stillOpen.length, "active blocker still needs", "active blockers still need")} work.`);
    }
    const labels = blockerLabels(active);
    for (const entry of stillOpen) reasons.push(`${labels.get(entry.blocker.id)}: ${entry.items.join(" ")}`);
  } else {
    const challenged = decision.evidence.filter((item) => item.status === "challenged").length;
    const unreviewed = decision.evidence.filter((item) => item.status === "unverified" && item.summary.trim()).length;
    const questions = decision.evidence.filter((item) => !item.summary.trim()).length;
    if (challenged + unreviewed + questions > 0) {
      state = "ready_for_review";
      reasons.push("No active blockers, but some evidence still needs attention.");
      if (challenged) reasons.push(`${plural(challenged, "evidence entry is", "evidence entries are")} challenged.`);
      if (unreviewed) reasons.push(`${plural(unreviewed, "evidence entry hasn't", "evidence entries haven't")} been reviewed.`);
      if (questions) reasons.push(`${plural(questions, "research question has", "research questions have")} no finding yet.`);
    } else {
      state = "ready_to_decide";
      reasons.push("Nothing is recorded as blocking it.");
    }
    const openSteps = decision.actions.filter((action) => !action.done).length;
    if (openSteps > 0) reasons.push(`${plural(openSteps, "next step is", "next steps are")} still open. That doesn't have to stop the decision.`);
  }

  const override = decision.readinessOverride?.reason ?? null;
  if (override && state !== "ready_to_decide") {
    return { state: "ready_to_decide", label: "Ready to decide (your call)", reasons, override };
  }
  return { state, label: READINESS_LABELS[state], reasons, override: state === "ready_to_decide" ? override : null };
}
