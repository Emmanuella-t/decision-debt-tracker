import { describe, expect, it } from "vitest";
import { summarize } from "./analytics";
import { QUICK_START_CHOICES } from "./blockers";
import { DECISIONS_STORAGE_KEY } from "./constants";
import {
  acceptSubmission,
  clearBlockerDraft,
  commitDecision,
  decisionToDraft,
  isValidRecord,
  loadDecisionStore,
  newActionDraft,
  newEvidenceDraft,
  normalizeStoredDecision,
  saveDecisions,
  withDebt,
} from "./data/decisions";
import { guidanceInput, nextBestStep, suggestActions } from "./guidance";
import { draftFromQuickStart, quickStartErrors } from "./quickstart";
import { deriveReadiness } from "./readiness";
import { computeDebt } from "./scoring";
import { memoryStorage, stored, today, todayDate } from "./test-fixtures";
import type { Decision } from "./types";
import { DecisionValidationError } from "./validation";

const launch = "Should we launch our product in November or January?";
const now = "2026-10-15T09:00:00.000Z";

function quickStart(choice: string, existing: Decision[] = [], title = launch): Decision[] {
  return commitDecision(existing, draftFromQuickStart(title, choice, today), { today, now });
}

function guidanceFor(decision: Decision) {
  const input = guidanceInput(decision);
  const result = suggestActions(input, { today });
  return { result, best: nextBestStep(input, result, today) };
}

function errorsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (error) {
    if (error instanceof DecisionValidationError) return error.errors;
    throw error;
  }
  return {};
}

describe("Quick Start answers", () => {
  it("accepts any real sentence, not only questions, and rejects empty or unclear input", () => {
    expect(quickStartErrors("Pick a launch month", "unsure")).toEqual({});
    expect(quickStartErrors("", "unsure").title).toMatch(/trying to decide/);
    expect(quickStartErrors("   \n ", "unsure").title).toMatch(/trying to decide/);
    expect(quickStartErrors("??", "unsure").title).toBeTruthy();
    expect(quickStartErrors("x".repeat(500), "unsure").title).toMatch(/characters/);
    expect(quickStartErrors(launch, "").choice).toBeTruthy();
    expect(quickStartErrors(launch, "made-up").choice).toBeTruthy();
  });

  it("maps every answer to an existing blocker category, or to none", () => {
    expect(Object.fromEntries(QUICK_START_CHOICES.map((item) => [item.value, item.type]))).toEqual({
      information: "missing_information",
      waiting: "waiting_for_approval",
      options: "difficult_tradeoffs",
      alignment: "stakeholder_disagreement",
      dependency: "dependency",
      unsure: "unknown",
      nothing: null,
    });
  });
});

describe("two-input creation", () => {
  it("creates a valid decision from the question and one choice, with generated id and time", () => {
    const [decision] = quickStart("information");
    expect(decision.id).toMatch(/\S{8,}/);
    expect(decision.title).toBe(launch);
    expect(decision.stage).toBe("new");
    expect(decision.createdDate).toBe(today);
    expect(decision.events[0]).toMatchObject({ type: "created", at: now });
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]).toMatchObject({ type: "missing_information", description: "", status: "active" });
    expect(isValidRecord(decision)).toBe(true);
  });

  it("saves no blocker when nothing is holding it up", () => {
    const [decision] = quickStart("nothing");
    expect(decision.blockers).toEqual([]);
    expect(deriveReadiness(decision)?.state).not.toBe("blocked");
  });

  it("records 'not sure yet' as an explicit unknown blocker", () => {
    const [decision] = quickStart("unsure");
    expect(decision.blockers[0]).toMatchObject({ type: "unknown", description: "" });
    const { best } = guidanceFor(decision);
    expect(best).toMatchObject({ kind: "suggestion", suggestion: { text: "Write down what feels unresolved about this decision.", ask: { key: "description" } } });
  });

  it("keeps existing decisions untouched", () => {
    const existing = stored({ id: "old" });
    const all = quickStart("waiting", [existing]);
    expect(all).toHaveLength(2);
    expect(all[1]).toBe(existing);
  });

  it("doesn't invent owner, department, deadline, ratings, evidence, or steps", () => {
    const [decision] = quickStart("alignment");
    expect(decision).toMatchObject({ owner: "", department: null, category: "", dueDate: null, impact: null, stress: null, urgency: null, exposure: null });
    expect(decision.evidence).toEqual([]);
    expect(decision.actions).toEqual([]);
    expect(decision.blockers[0]).toMatchObject({ owner: "", resolvesWhen: "", details: {} });
  });

  it("still goes through validation: a blank title can't be saved", () => {
    expect(errorsOf(() => quickStart("nothing", [], "   ")).title).toBeTruthy();
  });

  it("refuses a duplicate submission and a duplicate id", () => {
    const seen = new Set<string>();
    expect(acceptSubmission(seen, "s1")).toBe(true);
    expect(acceptSubmission(seen, "s1")).toBe(false);
    const draft = draftFromQuickStart(launch, "nothing", today);
    const [first] = commitDecision([], draft, { today, now });
    const again = { ...decisionToDraft(first), title: "Another" };
    // A copy that reuses the saved id must be an edit, not a second record.
    expect(commitDecision([first], again, { today, id: first.id })).toHaveLength(1);
  });
});

describe("unrated decisions", () => {
  it("are counted as open but left out of debt totals, and say they aren't scored", () => {
    const [quick] = quickStart("information");
    const rated = stored({ id: "rated" });
    const resolved = stored({ id: "done", resolvedDate: "2026-10-10", resolutionNote: "Went with January" });
    const summary = summarize([quick, rated, resolved], todayDate);
    expect(summary.openCount).toBe(2);
    expect(summary.unratedCount).toBe(1);
    expect(summary.open.map((item) => item.id)).toContain(quick.id);
    expect(summary.totalDebt).toBe(withDebt(rated, todayDate).debt);
    const view = withDebt(quick, todayDate);
    expect(view).toMatchObject({ scored: false, debt: 0, overdueDays: 0 });
  });

  it("keeps the existing formula for rated decisions", () => {
    const rated = stored();
    const expected = computeDebt({ createdDate: rated.createdDate, dueDate: rated.dueDate, impact: 5, stress: 5, today: todayDate });
    expect(withDebt(rated, todayDate)).toMatchObject({ debt: expected.debt, scored: true });
  });

  it("become scored once impact and stress are added in the full form", () => {
    const [quick] = quickStart("nothing");
    const edit = decisionToDraft(quick);
    edit.impact = 3;
    edit.stress = 4;
    edit.owner = "Priya";
    const [updated] = commitDecision([quick], edit, { today, id: quick.id, now });
    expect(updated).toMatchObject({ impact: 3, stress: 4, owner: "Priya" });
    expect(withDebt(updated, todayDate).scored).toBe(true);
  });

  it("treat a stored null as 'not rated' and a missing value as unreadable, as before", () => {
    const base = { ...stored(), impact: null, stress: null };
    const nullRated = normalizeStoredDecision(base)?.decision;
    expect(nullRated?.impact).toBeNull();
    const { impact: _omit, ...missing } = stored();
    void _omit;
    const broken = normalizeStoredDecision(missing)?.decision;
    expect(broken ? Number.isNaN(broken.impact) : true).toBe(true);
  });

  it("survive a reload with ratings still unset", () => {
    const storage = memoryStorage();
    const [quick] = quickStart("waiting");
    saveDecisions([quick], storage);
    expect(storage.memory.has(DECISIONS_STORAGE_KEY)).toBe(true);
    const [loaded] = loadDecisionStore(storage).decisions;
    expect(loaded).toEqual(quick);
  });
});

describe("first-step guidance", () => {
  it("starts a missing-information decision with a category-level step and one question", () => {
    const [decision] = quickStart("information");
    const { result, best } = guidanceFor(decision);
    expect(result.suggestions).toHaveLength(1);
    expect(best).toMatchObject({
      kind: "suggestion",
      suggestion: { text: "Identify the most important missing information needed to make this decision.", ask: { key: "description" } },
    });
  });

  it("gives every Quick Start category a first step without inventing names", () => {
    for (const choice of ["information", "waiting", "options", "alignment", "dependency", "unsure"]) {
      const [decision] = quickStart(choice);
      const { best } = guidanceFor(decision);
      expect(best.kind).toBe("suggestion");
      if (best.kind === "suggestion") expect(best.suggestion.text).not.toMatch(/\b(CFO|Finance|Legal|Priya)\b/);
    }
  });

  it("asks the next question once the first is answered", () => {
    const [decision] = quickStart("information");
    const edit = decisionToDraft(decision);
    edit.blockers[0].description = "Demand forecasts";
    const [answered] = commitDecision([decision], edit, { today, id: decision.id, now });
    const { best } = guidanceFor(answered);
    expect(best.kind).toBe("suggestion");
    if (best.kind === "suggestion") expect(best.suggestion.key).not.toBe(`${decision.blockers[0].id}:ask-description`);
  });

  it("prefers a linked step and hides the suggestion it came from", () => {
    const [decision] = quickStart("waiting");
    const blockerId = decision.blockers[0].id;
    const edit = decisionToDraft(decision);
    edit.blockers[0].details = { approver: "Finance lead" };
    const [named] = commitDecision([decision], edit, { today, id: decision.id, now });
    const suggestion = guidanceFor(named).result.suggestions[0];
    expect(suggestion.text).toMatch(/Finance lead/);

    const accept = decisionToDraft(named);
    accept.actions.push(newActionDraft(today, { description: suggestion.text, blockerId, suggestionKey: suggestion.key }));
    const [withStep] = commitDecision([named], accept, { today, id: named.id, now });
    const after = guidanceFor(withStep);
    expect(after.result.suggestions.map((item) => item.key)).not.toContain(suggestion.key);
    expect(after.best).toMatchObject({ kind: "action", text: suggestion.text });

    const dismissed = guidanceFor({ ...named, dismissedSuggestions: [suggestion.key] }).result.suggestions;
    expect(dismissed.map((item) => item.key)).not.toContain(suggestion.key);
  });

  it("completing the step leaves the blocker active and the decision open", () => {
    const [decision] = quickStart("waiting");
    const edit = decisionToDraft(decision);
    edit.actions.push(newActionDraft(today, { description: "Email the approver", blockerId: decision.blockers[0].id }));
    const [withStep] = commitDecision([decision], edit, { today, id: decision.id, now });
    const done = decisionToDraft(withStep);
    done.actions[0] = { ...done.actions[0], done: true, completedDate: today };
    const [completed] = commitDecision([withStep], done, { today, id: withStep.id, now });
    expect(completed.blockers[0].status).toBe("active");
    expect(completed.resolvedDate).toBeNull();
    expect(completed.events.at(-1)?.type).toBe("action_completed");
  });
});

describe("optional evidence and blocker history", () => {
  it("saves supporting information from just a finding and a source, unverified, without clearing the blocker", () => {
    const [decision] = quickStart("information");
    const edit = decisionToDraft(decision);
    edit.evidence.push(newEvidenceDraft(decision.blockers[0].id, { summary: "Finance expects lower demand in November", sourceName: "Finance team" }));
    const [saved] = commitDecision([decision], edit, { today, id: decision.id, now });
    expect(saved.evidence[0]).toMatchObject({ title: "", status: "unverified", collectedDate: null });
    expect(saved.blockers[0].status).toBe("active");
    expect(saved.events.at(-1)).toMatchObject({ type: "evidence_added", note: "Finance expects lower demand in November" });
  });

  it("labels history for an undescribed blocker by its type and records how it was cleared", () => {
    const [decision] = quickStart("unsure");
    expect(decision.events.find((event) => event.type === "blocker_added")?.note).toBe("Not sure yet");
    const cleared = clearBlockerDraft(decision, decision.blockers[0].id, { clearedHow: "not_applicable", reason: "We agreed it no longer matters.", resolvedDate: today });
    const [after] = commitDecision([decision], cleared, { today, id: decision.id, now });
    expect(after.blockers[0]).toMatchObject({ status: "resolved", clearedHow: "not_applicable" });
    expect(after.events.at(-1)).toMatchObject({ type: "blocker_resolved", note: "Not sure yet" });
    expect(after.resolvedDate).toBeNull();
  });
});
