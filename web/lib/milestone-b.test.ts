import { describe, expect, it } from "vitest";
import { summarize } from "./analytics";
import { DECISIONS_STORAGE_KEY, V2_DECISIONS_STORAGE_KEY } from "./constants";
import {
  applyDraft,
  clearBlockerDraft,
  commitDecision,
  decisionToDraft,
  isBlocked,
  loadDecisionStore,
  newActionDraft,
  newEvidenceDraft,
  removeBlockerFromDraft,
  withDebt,
} from "./data/decisions";
import { guidanceInput, nextBestStep, similarAction, suggestActions } from "./guidance";
import { deriveReadiness } from "./readiness";
import { computeDebt } from "./scoring";
import { blocker, draft, memoryStorage, savedAction, savedBlocker, savedEvidence, stored, today, todayDate } from "./test-fixtures";
import type { Decision } from "./types";
import { DecisionValidationError, safeUrl, validateDecision } from "./validation";

const launch = "Should we launch the new product in November or January?";

function guidanceFor(decision: Decision, decisions: Decision[] = []) {
  const input = guidanceInput(decision);
  const result = suggestActions(input, {
    today,
    decisions: decisions.map((item) => ({ id: item.id, title: item.title, resolved: Boolean(item.resolvedDate) })),
  });
  return { input, result };
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

describe("B1 blocker diagnosis and migration", () => {
  it("migrates a Milestone A (v2) store, keeping blockers, steps, and history, and leaves v2 untouched", () => {
    const v2 = {
      version: 2,
      decisions: [
        {
          schemaVersion: 2,
          id: "m-a",
          title: launch,
          description: "",
          category: "",
          department: "Product",
          owner: "Product Manager",
          impact: 4,
          stress: 3,
          urgency: null,
          reversibility: null,
          exposure: null,
          createdDate: "2026-10-01",
          dueDate: null,
          stage: "under_review",
          resolvedDate: null,
          resolutionNote: null,
          blockers: [
            {
              id: "b-old",
              type: "missing_information",
              description: "Reliable demand forecasts and launch cost estimates",
              owner: "",
              identifiedDate: "2026-10-01",
              resolvesWhen: "Both are reviewed",
              status: "active",
              resolvedDate: null,
              resolutionNote: null,
            },
          ],
          blockedWork: [{ id: "w1", title: "Marketing launch campaign" }],
          actions: [{ id: "a-old", description: "Request forecasts", owner: "", followUpDate: null, done: true, createdDate: "2026-10-01" }],
          events: [{ type: "created", at: "2026-10-01" }],
        },
      ],
    };
    const raw = JSON.stringify(v2);
    const storage = memoryStorage({ [V2_DECISIONS_STORAGE_KEY]: raw });
    const result = loadDecisionStore(storage);
    expect(result.migratedFrom).toBe(2);
    expect(result.quarantined).toBe(0);
    const [decision] = result.decisions;
    expect(decision.blockers[0]).toMatchObject({
      id: "b-old",
      description: "Reliable demand forecasts and launch cost estimates",
      details: {},
      unknowns: [],
      followUpDate: null,
      clearedHow: null,
    });
    expect(decision.actions[0]).toMatchObject({ id: "a-old", done: true, completedDate: null, blockerId: null, suggestionKey: null });
    expect(decision.evidence).toEqual([]);
    expect(decision.events).toEqual([{ type: "created", at: "2026-10-01" }]);
    expect(storage.memory.get(V2_DECISIONS_STORAGE_KEY)).toBe(raw);
    expect(JSON.parse(storage.memory.get(DECISIONS_STORAGE_KEY) ?? "{}").version).toBe(3);
    expect(withDebt(decision, todayDate).debt).toBe(
      computeDebt({ createdDate: "2026-10-01", dueDate: null, impact: 4, stress: 3, today: todayDate }).debt,
    );
  });

  it("saves a missing-information diagnosis with follow-ups and unknowns", () => {
    const [created] = commitDecision(
      [],
      draft({
        title: launch,
        createdDate: "2026-10-01",
        blockers: [
          blocker({
            description: "Comparable demand forecasts and launch cost estimates for November and January",
            details: { why_needed: "To see which date is commercially feasible", sources: "" },
            unknowns: ["sources"],
            followUpDate: "2026-10-20",
            resolvesWhen: "Both estimates are reviewed and comparable",
          }),
        ],
      }),
      { today },
    );
    expect(created.blockers[0].details).toEqual({ why_needed: "To see which date is commercially feasible" });
    expect(created.blockers[0].unknowns).toEqual(["sources"]);
    expect(created.blockers[0].followUpDate).toBe("2026-10-20");
  });

  it("validates approval diagnosis dates and rejects answers that don't belong to the type", () => {
    const approval = (details: Record<string, string>) =>
      validateDecision(
        draft({ createdDate: "2026-10-01", blockers: [blocker({ type: "waiting_for_approval", description: "Revised budget", details })] }),
        { today, decisions: [] },
      ).errors;
    expect(approval({ approver: "Finance lead", requested_on: "2026-10-05" })).toEqual({});
    expect(approval({ requested_on: "2026-10-30" })["blockers.0.details.requested_on"]).toMatch(/future/);
    expect(approval({ requested_on: "2026-02-30" })["blockers.0.details.requested_on"]).toMatch(/calendar/);
    expect(approval({ sources: "Finance" })["blockers.0.details"]).toMatch(/doesn't belong/);
    const badUnknown = validateDecision(draft({ createdDate: "2026-10-01", blockers: [blocker({ unknowns: ["approver"] })] }), { today, decisions: [] });
    expect(badUnknown.errors["blockers.0.details"]).toBeTruthy();
    const badFollowUp = validateDecision(draft({ createdDate: "2026-10-01", blockers: [blocker({ followUpDate: "2026-09-01" })] }), { today, decisions: [] });
    expect(badFollowUp.errors["blockers.0.followUpDate"]).toMatch(/before/);
  });

  it("drops unsupported stored blocker values instead of trusting them", () => {
    const record = { ...stored(), blockers: [savedBlocker(), { ...savedBlocker({ id: "b2" }), type: "magic" }, { ...savedBlocker({ id: "b3" }), details: { sources: "OK", evil: "x" }, unknowns: ["nope"] }] };
    const storage = memoryStorage({ [DECISIONS_STORAGE_KEY]: JSON.stringify({ version: 3, decisions: [record] }) });
    const result = loadDecisionStore(storage);
    expect(result.decisions[0].blockers.map((item) => item.id)).toEqual(["b1", "b3"]);
    expect(result.decisions[0].blockers[1].details).toEqual({ sources: "OK" });
    expect(result.decisions[0].blockers[1].unknowns).toEqual([]);
    expect(result.quarantined).toBe(1);
  });

  it("links a dependency only to a real, different decision", () => {
    const upstream = stored({ id: "up", title: "Packaging decision" });
    const dep = (id: string) =>
      validateDecision(
        draft({ createdDate: "2026-10-01", blockers: [blocker({ type: "dependency", description: "Packaging first", dependsOnDecisionId: id })] }),
        { today, decisions: [upstream], ignoreId: "self" },
      ).errors["blockers.0.dependsOnDecisionId"];
    expect(dep("up")).toBeUndefined();
    expect(dep("missing")).toMatch(/no longer exists/);
    expect(
      validateDecision(
        draft({ createdDate: "2026-10-01", blockers: [blocker({ dependsOnDecisionId: "up" })] }),
        { today, decisions: [upstream] },
      ).errors["blockers.0.dependsOnDecisionId"],
    ).toMatch(/Only/);
  });
});

describe("B2 guidance engine", () => {
  const forecast = savedBlocker({
    description: "Customer demand forecasts and launch cost estimates",
    details: { sources: "Finance and Marketing teams", why_needed: "To compare both launch dates" },
  });

  it("builds a missing-information suggestion from the saved answers and explains it", () => {
    const { result } = guidanceFor(stored({ title: launch, blockers: [forecast] }));
    const first = result.suggestions[0];
    expect(first.key).toBe("b1:request");
    expect(first.text).toBe("Request customer demand forecasts and launch cost estimates from Finance and Marketing teams.");
    expect(first.why).toContain(launch);
    expect(first.why).toContain("to compare both launch dates");
    expect(first.basedOn).toEqual(["What's missing", "Where it might come from"]);
  });

  it("stays grounded: no invented approvers, and sentence-like answers are quoted as written", () => {
    const approval = savedBlocker({ id: "b2", type: "waiting_for_approval", description: "The revised budget", details: {} });
    const { result } = guidanceFor(stored({ blockers: [approval] }));
    expect(result.suggestions[0].text).toBe("Confirm who you're waiting on for the revised budget.");
    expect(result.suggestions[0].ask?.key).toBe("approver");

    const named = savedBlocker({ id: "b3", type: "waiting_for_approval", description: "The revised budget", details: { approver: "Finance lead", requested_on: "2026-10-05" } });
    const followUp = guidanceFor(stored({ blockers: [named] })).result.suggestions[0];
    expect(followUp.text).toBe("Follow up with Finance lead on the revised budget.");
    expect(followUp.why).toContain("10 days ago");
    expect(followUp.ask).toBeUndefined();
  });

  it("covers each blocker type with a specific suggestion", () => {
    const types = [
      savedBlocker({ id: "s", type: "stakeholder_disagreement", description: "Sales wants November, Product wants January", details: { participants: "Sales and Product leads" } }),
      savedBlocker({ id: "t", type: "difficult_tradeoffs", description: "Vendor A and Vendor B", details: { criteria: "Total cost and integration effort" } }),
      savedBlocker({ id: "o", type: "ownership_unclear", description: "Marketing and Product", details: { clarifier: "Chief Operating Officer" } }),
      savedBlocker({ id: "d", type: "dependency", description: "The packaging decision", details: { upstream_owner: "Packaging lead" } }),
    ];
    const texts = guidanceFor(stored({ blockers: types })).result.suggestions.map((item) => item.text);
    expect(texts).toEqual([
      "Arrange a discussion with Sales and Product leads to agree which criteria matter.",
      "Compare Vendor A and Vendor B against total cost and integration effort.",
      "Ask Chief Operating Officer who has authority to make this decision.",
      "Check the status of the packaging decision with Packaging lead.",
    ]);
  });

  it("suggests checking a linked upstream decision by its real title", () => {
    const upstream = stored({ id: "up", title: "Choose packaging size" });
    const dep = savedBlocker({ type: "dependency", description: "Packaging first", dependsOnDecisionId: "up" });
    expect(guidanceFor(stored({ blockers: [dep] }), [upstream]).result.suggestions[0].text).toBe(
      "Check the status of “Choose packaging size”.",
    );
    const done = { ...upstream, resolvedDate: "2026-10-10", stage: "resolved" as const };
    expect(guidanceFor(stored({ blockers: [dep] }), [done]).result.suggestions[0].key).toBe("b1:upstream-done");
  });

  it("turns unknown answers into finding-out steps and reports when there isn't enough context", () => {
    const unknown = savedBlocker({ unknowns: ["sources"] });
    const keys = guidanceFor(stored({ blockers: [unknown] })).result.suggestions.map((item) => item.key);
    expect(keys).toContain("b1:find-source");
    const empty = savedBlocker({ description: "" });
    // With no description, the step is a category-level one that asks a single question.
    const blank = guidanceFor(stored({ blockers: [empty] })).result;
    expect(blank.suggestions).toHaveLength(1);
    expect(blank.suggestions[0]).toMatchObject({ key: "b1:ask-description", ask: { key: "description" } });
    expect(blank.suggestions[0].text).toBe("Identify the most important missing information needed to make this decision.");
    const other = savedBlocker({ type: "other", description: "Legal hasn't replied" });
    expect(guidanceFor(stored({ blockers: [other] })).result.suggestions[0]).toMatchObject({ ask: { key: "help" } });
  });

  it("doesn't repeat suggestions that are dismissed, already accepted, or already written as a step", () => {
    const base = stored({ title: launch, blockers: [forecast] });
    const text = guidanceFor(base).result.suggestions[0].text;
    expect(guidanceFor({ ...base, dismissedSuggestions: ["b1:request"] }).result.suggestions).toEqual([]);
    expect(guidanceFor({ ...base, actions: [savedAction({ description: "Ask Finance by Friday", suggestionKey: "b1:request" })] }).result.suggestions).toEqual([]);
    expect(guidanceFor({ ...base, actions: [savedAction({ description: text.toUpperCase() })] }).result.suggestions).toEqual([]);
    expect(similarAction("Request the forecasts from Finance.", "request the forecasts from finance")).toBe(true);
    expect(similarAction("Request the forecasts", "Book the venue")).toBe(false);
  });

  it("saves an edited suggestion only through an explicit save, linked and keyed", () => {
    const [created] = commitDecision([], draft({ title: launch, createdDate: "2026-10-01", blockers: [blocker({ description: "Demand forecasts" })] }), { today });
    const suggestion = guidanceFor(created).result.suggestions[0];
    // Nothing is created until the person saves.
    expect(created.actions).toEqual([]);
    const next = decisionToDraft(created);
    next.actions.push(newActionDraft(today, { description: "Ask Finance for Q3-based demand forecasts", blockerId: suggestion.blockerId ?? "", suggestionKey: suggestion.key }));
    const [saved] = commitDecision([created], next, { today, id: created.id });
    expect(saved.actions[0]).toMatchObject({ blockerId: created.blockers[0].id, suggestionKey: suggestion.key });
    expect(saved.events.at(-1)).toMatchObject({ type: "action_added", note: "Ask Finance for Q3-based demand forecasts" });
    expect(guidanceFor(saved).result.suggestions.some((item) => item.key === suggestion.key)).toBe(false);
  });

  it("picks one next best step, preferring an open step on an active blocker", () => {
    const decision = stored({ blockers: [forecast], actions: [savedAction({ id: "x", description: "Unrelated" }), savedAction({ id: "y", description: "Call Finance", blockerId: "b1" })] });
    const { input, result } = guidanceFor(decision);
    expect(nextBestStep(input, result)).toMatchObject({ kind: "action", text: "Call Finance" });
    const fresh = guidanceFor(stored({ blockers: [forecast] }));
    expect(nextBestStep(fresh.input, fresh.result)).toMatchObject({ kind: "suggestion" });
    const resolved = guidanceFor(stored({ stage: "resolved", resolvedDate: "2026-10-10", resolutionNote: "Done" }));
    expect(resolved.result.suggestions).toEqual([]);
  });

  it("handles an empty dataset", () => {
    expect(summarize([], todayDate).openCount).toBe(0);
    const { input, result } = guidanceFor(stored({ owner: "", dueDate: null }));
    expect(result.suggestions[0]).toMatchObject({ key: "decision:schedule", text: "Set a time to make the decision." });
    expect(nextBestStep(input, result).kind).toBe("suggestion");
    expect(loadDecisionStore(memoryStorage()).decisions).toEqual([]);
  });
});

describe("B3 evidence log", () => {
  it("accepts only http and https links", () => {
    expect(safeUrl("https://example.com/a?b=1").url).toBe("https://example.com/a?b=1");
    expect(safeUrl("http://intranet.local/report").error).toBeNull();
    expect(safeUrl("")).toEqual({ url: null, error: null });
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>", "ftp://example.com", "example.com", "https://user:pw@example.com", "https://exa mple.com"]) {
      expect(safeUrl(bad).error, bad).toBeTruthy();
    }
  });

  it("creates and edits evidence with timestamps and history", () => {
    const [created] = commitDecision([], draft({ createdDate: "2026-10-01", blockers: [blocker()] }), { today });
    const adding = decisionToDraft(created);
    adding.evidence.push(newEvidenceDraft(created.blockers[0].id, { title: "Vendor SOC 2 report", question: "Does the vendor meet our security bar?" }));
    const [withQuestion] = commitDecision([created], adding, { today, id: created.id, now: "2026-10-15T09:00:00.000Z" });
    expect(withQuestion.evidence[0]).toMatchObject({ status: "unverified", summary: "", url: null, createdAt: "2026-10-15T09:00:00.000Z" });
    expect(withQuestion.events.at(-1)).toMatchObject({ type: "evidence_added", note: "Vendor SOC 2 report" });

    const editing = decisionToDraft(withQuestion);
    editing.evidence[0] = { ...editing.evidence[0], summary: "Report covers 2025 only", collectedDate: "2026-10-14", url: "https://vendor.example/soc2", limitations: "Self-reported" };
    const [edited] = commitDecision([withQuestion], editing, { today, id: created.id, now: "2026-10-15T10:00:00.000Z" });
    expect(edited.evidence[0]).toMatchObject({ createdAt: "2026-10-15T09:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z", url: "https://vendor.example/soc2" });
    expect(edited.events.at(-1)).toMatchObject({ type: "evidence_updated" });
  });

  it("validates evidence fields", () => {
    const check = (overrides: Parameters<typeof newEvidenceDraft>[1], blockerId = "") =>
      validateDecision(draft({ createdDate: "2026-10-01", evidence: [newEvidenceDraft(blockerId, overrides)] }), { today, decisions: [] }).errors;
    expect(check({ title: "", summary: "Found it" })["evidence.0.title"]).toBeUndefined();
    expect(check({ title: "!!!", question: "Q?" })["evidence.0.title"]).toBeTruthy();
    expect(check({ title: "A", url: "javascript:alert(1)", question: "Q?" })["evidence.0.url"]).toMatch(/https/);
    expect(check({ title: "A", summary: "Found", collectedDate: "2026-10-30" })["evidence.0.collectedDate"]).toMatch(/future/);
    expect(check({ title: "A", summary: "Found", collectedDate: "2026-02-30" })["evidence.0.collectedDate"]).toMatch(/calendar/);
    expect(check({ title: "A", summary: "Found" })["evidence.0.collectedDate"]).toBeUndefined();
    expect(check({ title: "A", summary: "Found", status: "reviewed" })["evidence.0.collectedDate"]).toMatch(/when/);
    expect(check({ title: "A" })["evidence.0.summary"]).toBeTruthy();
    expect(check({ title: "A", question: "Q?" }, "missing")["evidence.0.blockerId"]).toMatch(/no longer exists/);
    expect(check({ title: "A", question: "Q?", sourceType: "rumor" as never })["evidence.0.sourceType"]).toBeTruthy();
  });

  it("moves between unverified, reviewed, and challenged, and needs a finding first", () => {
    const decision = stored({ createdDate: "2026-09-15", blockers: [savedBlocker()], evidence: [savedEvidence({ summary: "", collectedDate: null })] });
    const reviewing = decisionToDraft(decision);
    reviewing.evidence[0].status = "reviewed";
    expect(errorsOf(() => commitDecision([decision], reviewing, { today, id: "d1" }))["evidence.0.status"]).toMatch(/Record what was found/);

    const found = stored({ blockers: [savedBlocker()], evidence: [savedEvidence()] });
    let current = found;
    for (const status of ["reviewed", "challenged", "unverified"] as const) {
      const next = decisionToDraft(current);
      next.evidence[0].status = status;
      [current] = commitDecision([current], next, { today, id: "d1" });
      expect(current.evidence[0].status).toBe(status);
      expect(current.events.at(-1)).toMatchObject({ type: "evidence_status_changed", note: "Finance forecast" });
    }
    // Reviewing evidence never clears the blocker.
    expect(isBlocked(current)).toBe(true);
  });

  it("drops stored evidence with an unsafe link rather than rendering it", () => {
    const record = { ...stored({ blockers: [savedBlocker()] }), evidence: [savedEvidence(), { ...savedEvidence({ id: "e2" }), url: "javascript:alert(1)" }] };
    const storage = memoryStorage({ [DECISIONS_STORAGE_KEY]: JSON.stringify({ version: 3, decisions: [record] }) });
    const result = loadDecisionStore(storage);
    expect(result.decisions[0].evidence.map((item) => item.id)).toEqual(["e1"]);
    expect(result.quarantined).toBe(1);
  });
});

describe("B4 linked steps and readiness", () => {
  it("rejects steps that point to a missing blocker", () => {
    const errors = validateDecision(draft({ actions: [newActionDraft(today, { description: "Call Finance", blockerId: "ghost" })] }), { today, decisions: [] }).errors;
    expect(errors["actions.0.blockerId"]).toMatch(/no longer exists/);
  });

  it("keeps completed steps and evidence when their blocker is removed, unlinked and recorded", () => {
    const decision = stored({
      blockers: [savedBlocker()],
      actions: [savedAction({ blockerId: "b1", done: true, completedDate: "2026-10-10" })],
      evidence: [savedEvidence()],
    });
    const dangling = decisionToDraft(decision);
    dangling.blockers = [];
    expect(errorsOf(() => commitDecision([decision], dangling, { today, id: "d1" }))["actions.0.blockerId"]).toBeTruthy();
    const next = removeBlockerFromDraft(decisionToDraft(decision), "b1");
    const [edited] = commitDecision([decision], next, { today, id: "d1" });
    expect(edited.actions[0]).toMatchObject({ done: true, completedDate: "2026-10-10", blockerId: null });
    expect(edited.evidence[0].blockerId).toBeNull();
    expect(edited.events.at(-1)).toMatchObject({ type: "blocker_removed", detail: "Kept 1 linked steps and 1 evidence entries, now unlinked." });
  });

  it("records linking and completing steps without clearing the blocker", () => {
    const decision = stored({ blockers: [savedBlocker()], actions: [savedAction()] });
    const linking = decisionToDraft(decision);
    linking.actions[0].blockerId = "b1";
    const [linked] = commitDecision([decision], linking, { today, id: "d1" });
    expect(linked.events.at(-1)).toMatchObject({ type: "action_linked", note: "Ask Finance" });
    const completing = decisionToDraft(linked);
    completing.actions[0].done = true;
    const [done] = commitDecision([linked], completing, { today, id: "d1" });
    expect(done.actions[0].completedDate).toBe(today);
    expect(done.events.at(-1)).toMatchObject({ type: "action_completed" });
    expect(isBlocked(done)).toBe(true);
    expect(done.stage).toBe("new");
  });

  it("derives readiness from blockers, steps, and evidence, with reasons", () => {
    const criteria = "Both estimates are reviewed and comparable";
    const gap = deriveReadiness(stored({ blockers: [savedBlocker({ resolvesWhen: criteria })] }));
    expect(gap?.state).toBe("information_needed");
    expect(gap?.reasons[0]).toBe("1 active information gap still needs work.");
    expect(gap?.reasons.join(" ")).toMatch(/No reviewed evidence/);

    // Many unreviewed entries don't make it ready.
    const lots = deriveReadiness(
      stored({
        blockers: [savedBlocker({ resolvesWhen: criteria })],
        actions: [savedAction({ blockerId: "b1", done: true })],
        evidence: [savedEvidence({ id: "1" }), savedEvidence({ id: "2" }), savedEvidence({ id: "3" })],
      }),
    );
    expect(lots?.state).toBe("information_needed");

    const reviewed = deriveReadiness(
      stored({
        blockers: [savedBlocker({ resolvesWhen: criteria })],
        actions: [savedAction({ blockerId: "b1", done: true })],
        evidence: [savedEvidence({ status: "reviewed" })],
      }),
    );
    expect(reviewed?.state).toBe("ready_for_review");
    expect(reviewed?.reasons[0]).toMatch(/Check the clearing criteria/);

    const approval = deriveReadiness(stored({ blockers: [savedBlocker({ type: "waiting_for_approval", description: "Budget" })] }));
    expect(approval?.state).toBe("working_through_blockers");

    const clear = deriveReadiness(stored({ actions: [savedAction()] }));
    expect(clear).toMatchObject({ state: "ready_to_decide" });
    expect(clear?.reasons[1]).toMatch(/doesn't have to stop/);

    const challenged = deriveReadiness(stored({ evidence: [savedEvidence({ blockerId: null, status: "challenged" })] }));
    expect(challenged?.state).toBe("ready_for_review");
    expect(deriveReadiness(stored({ resolvedDate: "2026-10-10", stage: "resolved" }))).toBeNull();
  });

  it("keeps open items visible when the person notes it's ready anyway", () => {
    const decision = stored({ blockers: [savedBlocker()], readinessOverride: { reason: "Board meets Friday", at: today } });
    const readiness = deriveReadiness(decision);
    expect(readiness).toMatchObject({ state: "ready_to_decide", label: "Ready to decide (your call)", override: "Board meets Friday" });
    expect(readiness?.reasons[0]).toMatch(/information gap/);
    // The lifecycle rule still applies: the stage can't be "ready to decide" with an active blocker.
    const stage = decisionToDraft(decision);
    stage.stage = "ready_to_decide";
    expect(errorsOf(() => commitDecision([decision], stage, { today, id: "d1" })).stage).toBeTruthy();
    const tooShort = decisionToDraft(decision);
    tooShort.readinessOverride = "ok";
    expect(errorsOf(() => commitDecision([decision], tooShort, { today, id: "d1" })).readinessOverride).toBeTruthy();
  });
});

describe("B5 clearing guardrails", () => {
  const decision = stored({
    blockers: [savedBlocker({ resolvesWhen: "Both estimates reviewed" })],
    actions: [savedAction({ blockerId: "b1", done: true, completedDate: "2026-10-12" })],
    evidence: [savedEvidence({ status: "reviewed" })],
  });

  it("clears with criteria met when criteria exist, and records how", () => {
    const [cleared] = commitDecision([decision], clearBlockerDraft(decision, "b1", { clearedHow: "criteria_met", reason: "", resolvedDate: today }), { today, id: "d1" });
    expect(cleared.blockers[0]).toMatchObject({ status: "resolved", clearedHow: "criteria_met", resolvedDate: today });
    expect(cleared.events.at(-1)).toMatchObject({ type: "blocker_resolved", detail: "Clearing criteria met" });
    // Linked work and evidence stay with the cleared blocker.
    expect(cleared.actions[0].blockerId).toBe("b1");
    expect(cleared.evidence[0].blockerId).toBe("b1");
  });

  it("requires criteria for 'criteria met' and a reason for an override or not-applicable", () => {
    const noCriteria = stored({ blockers: [savedBlocker()] });
    expect(errorsOf(() => commitDecision([noCriteria], clearBlockerDraft(noCriteria, "b1", { clearedHow: "criteria_met", reason: "", resolvedDate: today }), { today, id: "d1" }))["blockers.0.clearedHow"]).toMatch(/no clearing criteria/);
    expect(errorsOf(() => commitDecision([noCriteria], clearBlockerDraft(noCriteria, "b1", { clearedHow: "override", reason: " ", resolvedDate: today }), { today, id: "d1" }))["blockers.0.resolutionNote"]).toMatch(/Explain/);
    expect(errorsOf(() => commitDecision([noCriteria], clearBlockerDraft(noCriteria, "b1", { clearedHow: "not_applicable", reason: "", resolvedDate: today }), { today, id: "d1" }))["blockers.0.resolutionNote"]).toMatch(/don't apply/);
    expect(errorsOf(() => commitDecision([noCriteria], clearBlockerDraft(noCriteria, "b1", { clearedHow: "override", reason: "Leadership accepted the risk", resolvedDate: "2026-10-30" }), { today, id: "d1" }))["blockers.0.resolvedDate"]).toMatch(/future/);

    const [overridden] = commitDecision(
      [noCriteria],
      clearBlockerDraft(noCriteria, "b1", { clearedHow: "override", reason: "Leadership accepted the risk", resolvedDate: today }),
      { today, id: "d1" },
    );
    expect(overridden.blockers[0]).toMatchObject({ clearedHow: "override", resolutionNote: "Leadership accepted the risk" });
    expect(overridden.events.at(-1)?.detail).toBe(
      "Cleared before the criteria were met: Leadership accepted the risk. Still open when cleared: No step or evidence is linked yet. No reviewed evidence is recorded for this information gap.",
    );
    expect(() => clearBlockerDraft(overridden, "b1", { clearedHow: "override", reason: "again", resolvedDate: today })).toThrow(/not active/);
  });

  it("preserves history across clearing, resolving, and reopening", () => {
    const [cleared] = commitDecision([decision], clearBlockerDraft(decision, "b1", { clearedHow: "criteria_met", reason: "", resolvedDate: today }), { today, id: "d1" });
    const resolving = decisionToDraft(cleared);
    Object.assign(resolving, { stage: "resolved", resolvedDate: today, resolutionNote: "Launch in January" });
    const [resolved] = commitDecision([cleared], resolving, { today, id: "d1" });
    const types = resolved.events.map((event) => event.type);
    expect(types).toEqual(["blocker_resolved", "resolved"]);
    expect(resolved.blockers[0].status).toBe("resolved");
    const reopenDraft = applyDraft(resolved, decisionToDraft(resolved), today);
    expect(reopenDraft.events).toEqual(resolved.events);
  });

  it("leaves the existing debt score unchanged by evidence, links, and readiness", () => {
    const plain = stored();
    const rich = stored({
      blockers: [savedBlocker()],
      actions: [savedAction({ blockerId: "b1" })],
      evidence: [savedEvidence({ status: "challenged" })],
      readinessOverride: { reason: "Board meets Friday", at: today },
    });
    expect(withDebt(rich, todayDate).debt).toBe(withDebt(plain, todayDate).debt);
    expect(withDebt(plain, todayDate).debt).toBe(
      computeDebt({ createdDate: "2026-09-15", dueDate: "2026-10-01", impact: 5, stress: 5, today: todayDate }).debt,
    );
  });
});
