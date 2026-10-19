import { describe, expect, it } from "vitest";
import { DECISIONS_STORAGE_KEY } from "./constants";
import { clearBlockerDraft, commitDecision, decisionToDraft, loadDecisionStore, withDebt } from "./data/decisions";
import { formatEventTime } from "./dates";
import { guidanceInput, nextBestStep, suggestActions } from "./guidance";
import { deriveReadiness } from "./readiness";
import { memoryStorage, savedAction, savedBlocker, savedEvidence, stored, today, todayDate } from "./test-fixtures";
import type { Decision } from "./types";
import { DecisionValidationError } from "./validation";

const launch = "Should we launch the new product in November or January?";
const longGap =
  "We lack reliable customer demand forecasts and complete launch cost estimates to determine whether launching the new product in November or January would be the better business decision.";
const now = "2026-10-15T18:30:00.000Z";

function guidanceFor(decision: Decision) {
  const input = guidanceInput(decision);
  const result = suggestActions(input, { today });
  return { input, result, best: nextBestStep(input, result, today) };
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

describe("concise, grounded guidance", () => {
  it("builds the suggestion from structured answers, not the long description", () => {
    const gap = savedBlocker({ description: longGap, details: { items: "Comparable demand forecasts and launch cost estimates for both launch options" } });
    const { result } = guidanceFor(stored({ title: launch, blockers: [gap] }));
    expect(result.suggestions[0].text).toBe("Request comparable demand forecasts and launch cost estimates for both launch options.");
    expect(result.suggestions[0].basedOn).toContain("Specific items needed");
    for (const suggestion of result.suggestions) {
      expect(suggestion.text).not.toContain(longGap.slice(0, 40));
      expect(suggestion.why).not.toContain(longGap.slice(0, 40));
    }

    const withSource = savedBlocker({ description: longGap, details: { items: "Demand forecasts", sources: "Finance team" } });
    expect(guidanceFor(stored({ blockers: [withSource] })).result.suggestions[0].text).toBe("Request demand forecasts from Finance team.");
  });

  it("asks for clarification instead of inventing a specific step when only a long description exists", () => {
    const { result, best } = guidanceFor(stored({ blockers: [savedBlocker({ description: longGap })] }));
    const ours = result.suggestions.filter((item) => item.blockerId === "b1");
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ key: "b1:ask-items", ask: { key: "items" } });
    expect(ours[0].text).not.toContain(longGap.slice(0, 30));
    expect(best).toMatchObject({ kind: "suggestion", suggestion: { key: "b1:ask-items" } });

    // A source alone gives a grounded but general step, and still asks for detail.
    const sourced = guidanceFor(stored({ blockers: [savedBlocker({ description: longGap, details: { sources: "Finance team" } })] })).result;
    expect(sourced.suggestions[0].text).toBe("Ask Finance team for the missing information.");
    expect(sourced.gaps[0].message).toMatch(/more precise/);

    // Long free-text names aren't pasted in as if they were a person.
    const vague = savedBlocker({ type: "waiting_for_approval", description: "The budget", details: { approver: "Probably the CFO, but it might need to go to the board as well" } });
    expect(guidanceFor(stored({ blockers: [vague] })).result.suggestions[0].text).toBe("Follow up with the person you noted on the budget.");

    const disagreement = savedBlocker({ type: "stakeholder_disagreement", description: longGap });
    expect(guidanceFor(stored({ blockers: [disagreement] })).result.suggestions[0]).toMatchObject({ ask: { key: "participants" } });
  });

  it("shows the existing linked step instead of an equivalent suggestion", () => {
    const gap = savedBlocker({ details: { items: "Demand forecasts", sources: "Finance team" } });
    const step = savedAction({ description: "Email Priya about the Q3 numbers", blockerId: "b1", followUpDate: "2026-10-10" });
    const { result, best } = guidanceFor(stored({ blockers: [gap], actions: [step] }));
    expect(result.suggestions.some((item) => item.key === "b1:request")).toBe(false);
    expect(result.covered).toEqual([{ blockerId: "b1", actionIndex: 0 }]);
    expect(best).toMatchObject({ kind: "action", text: "Email Priya about the Q3 numbers", followUpDate: "2026-10-10", overdue: true });

    // A finished step doesn't count as covering the blocker.
    const done = guidanceFor(stored({ blockers: [gap], actions: [{ ...step, done: true, completedDate: "2026-10-12" }] })).result;
    expect(done.suggestions.some((item) => item.key === "b1:request")).toBe(true);
  });

  it("flags overlapping wording as a hint without claiming it's the same step", () => {
    const gap = savedBlocker({ details: { items: "Demand forecasts", sources: "Finance team" } });
    const unlinked = savedAction({ description: "Request the demand forecasts" });
    const { result } = guidanceFor(stored({ blockers: [gap], actions: [unlinked] }));
    const request = result.suggestions.find((item) => item.key === "b1:request");
    expect(request?.similarTo).toBe("Request the demand forecasts");
    const unrelated = guidanceFor(stored({ blockers: [gap], actions: [savedAction({ description: "Book the venue" })] })).result;
    expect(unrelated.suggestions.find((item) => item.key === "b1:request")?.similarTo).toBeUndefined();
  });

  it("keeps readiness reasons short by naming blockers instead of quoting them", () => {
    const readiness = deriveReadiness(stored({ blockers: [savedBlocker({ description: longGap }), savedBlocker({ id: "b2", description: "Pricing" })] }));
    expect(readiness?.reasons.join(" ")).not.toContain(longGap.slice(0, 30));
    expect(readiness?.reasons[1]).toMatch(/^Missing information \(1\):/);
    expect(readiness?.reasons[2]).toMatch(/^Missing information \(2\):/);
  });
});

describe("blocker-clearing accountability", () => {
  const withOpenStep = stored({
    blockers: [savedBlocker({ resolvesWhen: "Both estimates reviewed" })],
    actions: [savedAction({ blockerId: "b1" })],
    evidence: [savedEvidence()],
  });

  it("requires an explanation for 'criteria met' while items are still open, and records them", () => {
    const silent = clearBlockerDraft(withOpenStep, "b1", { clearedHow: "criteria_met", reason: "", resolvedDate: today });
    expect(errorsOf(() => commitDecision([withOpenStep], silent, { today, id: "d1", now }))["blockers.0.resolutionNote"]).toMatch(/still open/);
    const tooShort = clearBlockerDraft(withOpenStep, "b1", { clearedHow: "criteria_met", reason: "ok", resolvedDate: today });
    expect(errorsOf(() => commitDecision([withOpenStep], tooShort, { today, id: "d1", now }))["blockers.0.resolutionNote"]).toBeTruthy();

    const explained = clearBlockerDraft(withOpenStep, "b1", { clearedHow: "criteria_met", reason: "Finance confirmed by phone; the email can wait", resolvedDate: today });
    const [cleared] = commitDecision([withOpenStep], explained, { today, id: "d1", now });
    const event = cleared.events.at(-1);
    expect(event).toMatchObject({ type: "blocker_resolved", at: now });
    expect(event?.detail).toMatch(/^Clearing criteria met: Finance confirmed by phone; the email can wait\. Still open when cleared: 1 linked step is unfinished\./);
  });

  it("doesn't require an explanation when nothing is outstanding", () => {
    const clean = stored({
      blockers: [savedBlocker({ resolvesWhen: "Both estimates reviewed" })],
      actions: [savedAction({ blockerId: "b1", done: true, completedDate: "2026-10-12" })],
      evidence: [savedEvidence({ status: "reviewed" })],
    });
    const [cleared] = commitDecision([clean], clearBlockerDraft(clean, "b1", { clearedHow: "criteria_met", reason: "", resolvedDate: today }), { today, id: "d1", now });
    expect(cleared.events.at(-1)).toEqual({ type: "blocker_resolved", at: now, note: clean.blockers[0].description, detail: "Clearing criteria met" });
  });

  it("requires a real explanation for 'don't apply' and 'clear anyway', and keeps it through later edits", () => {
    for (const clearedHow of ["not_applicable", "override"] as const) {
      const short = clearBlockerDraft(withOpenStep, "b1", { clearedHow, reason: "n/a", resolvedDate: today });
      expect(errorsOf(() => commitDecision([withOpenStep], short, { today, id: "d1", now }))["blockers.0.resolutionNote"]).toMatch(/at least 10/);
    }
    const reason = "Leadership accepted the forecast risk";
    const [overridden] = commitDecision([withOpenStep], clearBlockerDraft(withOpenStep, "b1", { clearedHow: "override", reason, resolvedDate: today }), { today, id: "d1", now });
    const edit = decisionToDraft(overridden);
    edit.title = "Choose a vendor for Q1";
    const [edited] = commitDecision([overridden], edit, { today, id: "d1", now: "2026-10-15T19:00:00.000Z" });
    expect(edited.blockers[0]).toMatchObject({ status: "resolved", clearedHow: "override", resolutionNote: reason });
    expect(edited.events.filter((item) => item.type === "blocker_resolved")).toHaveLength(1);
  });

  it("stamps the clearance with the save time and labels a corrected date separately", () => {
    const backdated = clearBlockerDraft(withOpenStep, "b1", { clearedHow: "override", reason: "It was settled in last week's meeting", resolvedDate: "2026-10-09" });
    const [cleared] = commitDecision([withOpenStep], backdated, { today, id: "d1", now });
    expect(cleared.blockers[0].resolvedDate).toBe("2026-10-09");
    const event = cleared.events.at(-1);
    expect(event?.at).toBe(now);
    expect(event?.detail).toMatch(/Cleared date entered as Oct 9, 2026\.$/);
    expect(formatEventTime(now)).toMatch(/2026/);
    expect(formatEventTime("2026-08-01")).toBe("Aug 1, 2026");
  });

  it("never marks evidence reviewed, completes steps, or resolves the decision when the last blocker clears", () => {
    const [cleared] = commitDecision(
      [withOpenStep],
      clearBlockerDraft(withOpenStep, "b1", { clearedHow: "override", reason: "Leadership accepted the forecast risk", resolvedDate: today }),
      { today, id: "d1", now },
    );
    expect(cleared.evidence[0]).toEqual(withOpenStep.evidence[0]);
    expect(cleared.actions[0]).toEqual(withOpenStep.actions[0]);
    expect(cleared.stage).toBe(withOpenStep.stage);
    expect(cleared.resolvedDate).toBeNull();
    expect(cleared.events.some((item) => item.type === "resolved")).toBe(false);
    expect(withDebt(cleared, todayDate).debt).toBe(withDebt(withOpenStep, todayDate).debt);
  });
});

describe("legacy compatibility", () => {
  it("loads saved records with date-only history and no structured items, unchanged", () => {
    const legacy = stored({
      blockers: [savedBlocker({ description: longGap, details: { sources: "Finance team" } })],
      actions: [savedAction({ blockerId: "b1" })],
      events: [{ type: "created", at: "2026-09-15" }, { type: "blocker_added", at: "2026-09-20", note: longGap }],
    });
    const storage = memoryStorage({ [DECISIONS_STORAGE_KEY]: JSON.stringify({ version: 3, decisions: [legacy] }) });
    const { decisions, migratedFrom } = loadDecisionStore(storage);
    expect(migratedFrom).toBeNull();
    expect(decisions[0]).toEqual(legacy);
    expect(decisions[0].actions[0].blockerId).toBe("b1");
    // The linked step still covers the blocker, so no duplicate suggestion appears.
    expect(guidanceFor(decisions[0]).result.suggestions.some((item) => item.key === "b1:request")).toBe(false);
  });
});
