import { describe, expect, it } from "vitest";
import { addISODays, diffISODays, isRealDate, localTodayISO } from "./dates";
import { debtByDepartment, needsAttention, percentChange, priorSnapshot, summarize, trendReady, upsertSnapshot } from "./analytics";
import { vagueTitleHint } from "./blockers";
import { DECISIONS_STORAGE_KEY, LEGACY_DECISIONS_STORAGE_KEY, QUARANTINE_STORAGE_KEY } from "./constants";
import {
  acceptSubmission,
  applyDraft,
  commitDecision,
  decisionToDraft,
  isBlocked,
  knownWorkItems,
  loadDecisionStore,
  loadDecisions,
  newActionDraft,
  newWorkItem,
  reopenDecision,
  resolutionDraft,
  saveDecisions,
  withDebt,
} from "./data/decisions";
import { computeDebt } from "./scoring";
import { blocker, draft, memoryStorage, savedAction, savedBlocker, savedEvidence, stored, today, todayDate } from "./test-fixtures";
import type { BlockerDraft, DecisionDraft } from "./types";
import { DecisionValidationError, stepForErrorKey, validateDecision } from "./validation";

const v1Record = {
  id: "legacy-1",
  title: "Pick a CRM",
  description: "Old record",
  category: "tools",
  department: "Sales",
  impact: 4,
  stress: 3,
  createdDate: "2026-08-01",
  dueDate: "2026-09-01",
  resolvedDate: null,
  resolutionNote: null,
  events: [{ type: "created", at: "2026-08-01" }],
};

describe("dates", () => {
  it("accepts leap days and rejects impossible dates", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2000-02-29")).toBe(true);
    expect(isRealDate("2023-02-29")).toBe(false);
    expect(isRealDate("1900-02-29")).toBe(false);
    expect(isRealDate("2026-04-31")).toBe(false);
    expect(isRealDate("2026-02-29")).toBe(false);
  });

  it("counts calendar days across a daylight-saving boundary", () => {
    expect(diffISODays("2026-03-08", "2026-03-09")).toBe(1);
    expect(addISODays("2026-10-15", -30)).toBe("2026-09-15");
  });

  it("formats today in the local calendar, not UTC", () => {
    const evening = new Date(2026, 9, 15, 23, 30, 0, 0);
    expect(localTodayISO(evening)).toBe("2026-10-15");
  });
});

describe("validation", () => {
  it("rejects a blank or symbol-only title and an overly long title", () => {
    expect(validateDecision(draft({ title: "   " }), { today, decisions: [] }).errors.title).toBeTruthy();
    expect(validateDecision(draft({ title: "???" }), { today, decisions: [] }).errors.title).toMatch(/words/);
    expect(validateDecision(draft({ title: "a".repeat(121) }), { today, decisions: [] }).errors.title).toMatch(/120/);
  });

  it("only suggests a better title, never blocks a vague one", () => {
    expect(vagueTitleHint("Budget")).toMatch(/topic/);
    expect(vagueTitleHint("Should we increase the Q4 budget?")).toBeNull();
    expect(validateDecision(draft({ title: "Budget" }), { today, decisions: [] }).errors.title).toBeUndefined();
  });

  it("rejects a target date before the created date and allows a past target date", () => {
    const backwards = validateDecision(draft({ createdDate: "2026-10-10", dueDate: "2026-10-01" }), { today, decisions: [] });
    expect(backwards.errors.dueDate).toMatch(/cannot be earlier/);
    const overdue = validateDecision(draft({ createdDate: "2026-09-01", dueDate: "2026-09-20" }), { today, decisions: [] });
    expect(overdue.errors.dueDate).toBeUndefined();
    expect(overdue.warnings.join(" ")).toMatch(/already passed/);
  });

  it("rejects invalid decision, blocker, and step dates", () => {
    const check = (d: DecisionDraft) => validateDecision(d, { today, decisions: [] }).errors;
    expect(check(draft({ createdDate: "2026-10-16" })).createdDate).toMatch(/future/);
    expect(check(draft({ createdDate: "2023-02-29" })).createdDate).toMatch(/calendar/);
    expect(check(draft({ stage: "resolved", createdDate: "2026-10-10", resolvedDate: "2026-10-01", resolutionNote: "A" })).resolvedDate).toMatch(
      /cannot be earlier/,
    );
    expect(check(draft({ stage: "resolved", resolvedDate: "2026-10-16", resolutionNote: "A" })).resolvedDate).toMatch(/future/);
    const created = "2026-10-01";
    expect(check(draft({ createdDate: created, blockers: [blocker({ identifiedDate: "2026-10-20" })] }))["blockers.0.identifiedDate"]).toMatch(/future/);
    expect(check(draft({ createdDate: created, blockers: [blocker({ identifiedDate: "2026-09-01" })] }))["blockers.0.identifiedDate"]).toMatch(/before/);
    expect(check(draft({ createdDate: created, blockers: [blocker({ identifiedDate: "2026-02-30" })] }))["blockers.0.identifiedDate"]).toMatch(/calendar/);
    expect(
      check(draft({ createdDate: created, blockers: [blocker({ status: "resolved", identifiedDate: "2026-10-05", resolvedDate: "2026-10-02" })] }))[
        "blockers.0.resolvedDate"
      ],
    ).toMatch(/before it was noticed/);
    const step = { ...newActionDraft(today), description: "Ask Finance", followUpDate: "2026-09-01" };
    expect(check(draft({ createdDate: created, actions: [step] }))["actions.0.followUpDate"]).toMatch(/before/);
  });

  it("requires an outcome and rejects bad ratings, departments, stages, and exposure", () => {
    const check = (d: DecisionDraft) => validateDecision(d, { today, decisions: [] }).errors;
    expect(check(draft({ stage: "resolved", resolvedDate: today, resolutionNote: " " })).resolutionNote).toMatch(/decided/);
    expect(check(draft({ impact: Number.NaN })).impact).toBeTruthy();
    expect(check(draft({ stress: Number.POSITIVE_INFINITY })).stress).toBeTruthy();
    expect(check(draft({ impact: 0 })).impact).toBeTruthy();
    expect(check(draft({ impact: 1.5 })).impact).toBeTruthy();
    expect(check(draft({ department: "Finance" })).department).toBeTruthy();
    expect(check(draft({ stage: "paused" as DecisionDraft["stage"] })).stage).toBeTruthy();
    expect(check(draft({ exposure: "-5" })).exposure).toBeTruthy();
    expect(check(draft({ exposure: "12.345" })).exposure).toBeTruthy();
    expect(check(draft({ exposure: "25,000.50" })).exposure).toBeUndefined();
  });

  it("rejects invalid blocker states", () => {
    const check = (d: DecisionDraft) => validateDecision(d, { today, decisions: [] }).errors;
    expect(check(draft({ createdDate: "2026-10-01", stage: "ready_to_decide", blockers: [blocker()] })).stage).toMatch(/ready to decide/);
    expect(
      check(draft({ createdDate: "2026-10-01", stage: "resolved", resolvedDate: today, resolutionNote: "Went with A", blockers: [blocker()] })).stage,
    ).toMatch(/active blockers/);
    // A description is optional (Quick Start saves the type only), but a present one must be real text.
    expect(check(draft({ createdDate: "2026-10-01", blockers: [blocker({ description: "  " })] }))["blockers.0.description"]).toBeUndefined();
    expect(check(draft({ createdDate: "2026-10-01", blockers: [blocker({ description: "!!!" })] }))["blockers.0.description"]).toBeTruthy();
    expect(check(draft({ createdDate: "2026-10-01", blockers: [blocker({ type: "bad" as BlockerDraft["type"] })] }))["blockers.0.type"]).toBeTruthy();
    expect(check(draft({ createdDate: "2026-10-01", blockers: [blocker({ resolvedDate: "2026-10-02" })] }))["blockers.0.resolvedDate"]).toMatch(
      /active/,
    );
    expect(check(draft({ createdDate: "2026-10-01", blockers: [blocker({ status: "paused" as "active" })] }))["blockers.0.status"]).toBeTruthy();
    // Under review with an active blocker is a valid combination: blocked is not a stage.
    expect(check(draft({ createdDate: "2026-10-01", stage: "under_review", blockers: [blocker()] }))).toEqual({});
  });

  it("validates linked records and maps errors to the step that owns them", () => {
    const same = blocker();
    const errors = validateDecision(
      draft({
        createdDate: "2026-10-01",
        blockers: [same, { ...same }],
        blockedWork: [newWorkItem("Q4 campaign"), newWorkItem("q4 CAMPAIGN ")],
        actions: [{ ...newActionDraft(today), description: "!" }],
      }),
      { today, decisions: [] },
    ).errors;
    expect(errors["blockers.1.description"]).toMatch(/duplicate/);
    expect(errors["blockedWork.1.title"]).toMatch(/already linked/);
    expect(errors["actions.0.description"]).toBeTruthy();
    expect(stepForErrorKey("blockers.1.description")).toBe(1);
    expect(stepForErrorKey("blockedWork.1.title")).toBe(2);
    expect(stepForErrorKey("actions.0.description")).toBe(3);
    expect(stepForErrorKey("title")).toBe(0);
  });
});

describe("decisions", () => {
  it("creates a valid decision with blockers, waiting work, and next steps", () => {
    const [created] = commitDecision(
      [],
      draft({
        title: "Should we delay the launch to November?",
        owner: "Priya",
        createdDate: "2026-10-01",
        stage: "under_review",
        urgency: "high",
        reversibility: "costly",
        exposure: "25000",
        blockers: [blocker({ owner: "Security team", resolvesWhen: "Review is shared" })],
        blockedWork: [newWorkItem("Q4 campaign")],
        actions: [{ ...newActionDraft(today), description: "Request the security report", followUpDate: "2026-10-20" }],
      }),
      { today },
    );
    expect(created.schemaVersion).toBe(3);
    expect(created.stage).toBe("under_review");
    expect(isBlocked(created)).toBe(true);
    expect(created.exposure).toBe(25000);
    expect(created.blockers[0].resolvedDate).toBeNull();
    expect(created.actions[0].followUpDate).toBe("2026-10-20");
    expect(created.events.map((event) => event.type)).toEqual(["created", "blocker_added", "action_added"]);
  });

  it("edits blockers: clearing records history and cleared blockers can't be dropped", () => {
    const [created] = commitDecision([], draft({ createdDate: "2026-10-01", blockers: [blocker()] }), { today });
    const clearing = decisionToDraft(created);
    clearing.blockers[0] = { ...clearing.blockers[0], status: "resolved", resolvedDate: "2026-10-10", resolutionNote: "Report arrived" };
    clearing.stage = "ready_to_decide";
    // Clearing without saying how is rejected at the persistence boundary.
    expect(() => commitDecision([created], clearing, { today, id: created.id })).toThrow(DecisionValidationError);
    clearing.blockers[0].clearedHow = "override";
    const [cleared] = commitDecision([created], clearing, { today, id: created.id });
    expect(isBlocked(cleared)).toBe(false);
    expect(cleared.events.some((event) => event.type === "blocker_resolved" && event.detail?.includes("Report arrived"))).toBe(true);

    const dropping = decisionToDraft(cleared);
    dropping.blockers = [];
    const [kept] = commitDecision([cleared], dropping, { today, id: created.id });
    expect(kept.blockers).toHaveLength(1);
    expect(kept.blockers[0].status).toBe("resolved");
  });

  it("removing an active blocker is recorded", () => {
    const [created] = commitDecision([], draft({ createdDate: "2026-10-01", blockers: [blocker()] }), { today });
    const next = decisionToDraft(created);
    next.blockers = [];
    const [edited] = commitDecision([created], next, { today, id: created.id });
    expect(edited.blockers).toHaveLength(0);
    expect(edited.events.at(-1)).toMatchObject({ type: "blocker_removed", note: "No security review yet" });
  });

  it("resolves only after blockers are confirmed closed, then reopens with a reason", () => {
    const list = commitDecision([], draft({ createdDate: "2026-10-01", blockers: [blocker()] }), { today });
    const id = list[0].id;
    const unconfirmed = resolutionDraft(list[0], { resolvedDate: "2026-10-14", outcome: "Went with A", closeBlockers: false });
    expect(() => commitDecision(list, unconfirmed, { today, id })).toThrow(DecisionValidationError);

    const confirmed = resolutionDraft(list[0], { resolvedDate: "2026-10-14", outcome: "Went with A", closeBlockers: true });
    const resolved = commitDecision(list, confirmed, { today, id });
    expect(resolved[0].stage).toBe("resolved");
    expect(resolved[0].blockers[0]).toMatchObject({ status: "resolved", resolvedDate: "2026-10-14" });

    expect(() => reopenDecision(resolved, id, "  ", today)).toThrow(DecisionValidationError);
    const reopened = reopenDecision(resolved, id, "Vendor A pulled out", today);
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ stage: "under_review", resolvedDate: null, resolutionNote: null });
    expect(reopened[0].events.at(-1)).toMatchObject({
      type: "reopened",
      note: "Vendor A pulled out",
      detail: "Previous outcome: Went with A",
    });
    expect(() => reopenDecision(reopened, id, "again", today)).toThrow(/already open/);
  });

  it("saves and reopens from storage with every field intact", () => {
    const storage = memoryStorage();
    const saved = commitDecision(
      [],
      draft({
        createdDate: "2026-10-01",
        owner: "Sam",
        urgency: "low",
        blockers: [blocker()],
        blockedWork: [newWorkItem("Pricing page")],
        actions: [{ ...newActionDraft(today), description: "Call vendor" }],
      }),
      { today },
    );
    saveDecisions(saved, storage);
    const envelope = JSON.parse(storage.memory.get(DECISIONS_STORAGE_KEY) ?? "{}");
    expect(envelope.version).toBe(3);
    expect(loadDecisions(storage)).toEqual(saved);
  });

  it("keeps form data through a draft round trip", () => {
    const original = stored({
      owner: "Lee",
      urgency: "high",
      reversibility: "irreversible",
      exposure: 1250.5,
      blockers: [savedBlocker({ details: { why_needed: "To compare dates" }, unknowns: ["sources"], followUpDate: "2026-10-20" })],
      blockedWork: [{ id: "w1", title: "Hiring plan" }],
      actions: [savedAction({ id: "a1", description: "Draft options", blockerId: "b1" }), savedAction({ id: "a2", description: "Old finished step", done: true })],
      evidence: [savedEvidence()],
      dismissedSuggestions: ["b1:find-source"],
      readinessOverride: { reason: "Leadership wants a call this week", at: "2026-10-10" },
    });
    const round = applyDraft(original, decisionToDraft(original), today, "2026-10-15T12:00:00.000Z");
    expect(round).toEqual(original);
    // A step finished before completion dates existed doesn't get an invented date.
    expect(round.actions[1].completedDate).toBeNull();
  });

  it("guards against duplicate submissions and duplicate ids", () => {
    const seen = new Set<string>();
    expect(acceptSubmission(seen, "sub-1")).toBe(true);
    expect(acceptSubmission(seen, "sub-1")).toBe(false);
    expect(acceptSubmission(seen, "")).toBe(false);
    expect(() => saveDecisions([stored(), stored()], memoryStorage())).toThrow(/same id|id d1/);
    expect(() => commitDecision([], draft({ title: " " }), { today })).toThrow(DecisionValidationError);
    expect(() => commitDecision([], draft(), { today, id: "missing" })).toThrow(DecisionValidationError);
  });

  it("suggests waiting work already used elsewhere without duplicates", () => {
    const list = [
      stored({ id: "a", blockedWork: [{ id: "1", title: "Q4 campaign" }] }),
      stored({ id: "b", blockedWork: [{ id: "2", title: "q4 campaign" }, { id: "3", title: "Billing" }] }),
    ];
    expect(knownWorkItems(list)).toEqual(["Billing", "Q4 campaign"]);
  });
});

describe("storage migration", () => {
  it("migrates v1 records with safe defaults and leaves the v1 copy untouched", () => {
    const raw = JSON.stringify([v1Record, { ...v1Record, id: "legacy-2", resolvedDate: "2026-09-10", resolutionNote: "Chose B" }]);
    const storage = memoryStorage({ [LEGACY_DECISIONS_STORAGE_KEY]: raw });
    const result = loadDecisionStore(storage);
    expect(result.migratedFrom).toBe(1);
    expect(result.quarantined).toBe(0);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({
      schemaVersion: 3,
      evidence: [],
      dismissedSuggestions: [],
      readinessOverride: null,
      stage: "new",
      owner: "",
      urgency: null,
      exposure: null,
      blockers: [],
      blockedWork: [],
      actions: [],
      events: [{ type: "created", at: "2026-08-01" }],
    });
    expect(result.decisions[1].stage).toBe("resolved");
    expect(storage.memory.get(LEGACY_DECISIONS_STORAGE_KEY)).toBe(raw);
    expect(storage.memory.has(DECISIONS_STORAGE_KEY)).toBe(true);

    const again = loadDecisionStore(storage);
    expect(again.migratedFrom).toBeNull();
    expect(again.decisions).toEqual(result.decisions);
  });

  it("keeps scores identical after migration and ignores the new fields", () => {
    const storage = memoryStorage({ [LEGACY_DECISIONS_STORAGE_KEY]: JSON.stringify([v1Record]) });
    const [migrated] = loadDecisions(storage);
    const before = computeDebt({ ...v1Record, today: todayDate });
    expect(withDebt(migrated, todayDate).debt).toBe(before.debt);
    const decorated = { ...migrated, blockers: [savedBlocker()], evidence: [savedEvidence()], urgency: "high" as const, exposure: 1e6 };
    expect(withDebt(decorated, todayDate).debt).toBe(before.debt);
  });

  it("recovers from malformed storage without deleting anything", () => {
    const broken = "{not json";
    const storage = memoryStorage({ [DECISIONS_STORAGE_KEY]: broken });
    const result = loadDecisionStore(storage);
    expect(result.storeUnreadable).toBe(true);
    expect(result.decisions).toEqual([]);
    expect(storage.memory.get(DECISIONS_STORAGE_KEY)).toBe(broken);
    expect(JSON.parse(storage.memory.get(QUARANTINE_STORAGE_KEY) ?? "[]")[0].raw).toBe(broken);
  });

  it("keeps readable records and sets aside unreadable entries and duplicate ids", () => {
    const good = stored({ id: "good" });
    const partial = { ...stored({ id: "partial" }), blockers: [{ id: "x", type: "nonsense" }] };
    const envelope = { version: 2, decisions: [good, 42, { title: "no id" }, { ...good, title: "Duplicate" }, partial] };
    const storage = memoryStorage({ [DECISIONS_STORAGE_KEY]: JSON.stringify(envelope) });
    const result = loadDecisionStore(storage);
    expect(result.decisions.map((item) => item.id)).toEqual(["good", "partial"]);
    expect(result.decisions[0].title).toBe("Choose a vendor");
    expect(result.decisions[1].blockers).toEqual([]);
    expect(result.quarantined).toBe(4);
    const quarantine = JSON.parse(storage.memory.get(QUARANTINE_STORAGE_KEY) ?? "[]");
    expect(quarantine.map((entry: { reason: string }) => entry.reason)).toEqual([
      "Unreadable decision",
      "Unreadable decision",
      "Duplicate decision id",
      "Part of this decision could not be read",
    ]);
  });
});

describe("analytics", () => {
  it("counts open and overdue debt without resolved decisions", () => {
    const decisions = [
      stored({ id: "open-overdue" }),
      stored({ id: "open-current", dueDate: today, createdDate: "2026-10-10" }),
      stored({ id: "resolved", stage: "resolved", resolvedDate: "2026-10-12", resolutionNote: "Done" }),
      stored({ id: "bad", impact: 9 }),
    ];
    const summary = summarize(decisions, todayDate);
    expect(summary.openCount).toBe(2);
    expect(summary.overdueCount).toBe(1);
    expect(summary.unscorableCount).toBe(1);
    expect(summary.totalDebt).toBe(summary.open.reduce((sum, item) => sum + item.debt, 0));
    expect(summary.open.some((item) => item.id === "resolved")).toBe(false);
  });

  it("splits department debt by score and stays safe when data is missing", () => {
    const summary = summarize(
      [
        stored({ id: "a", department: "Product", impact: 5, stress: 5 }),
        stored({ id: "b", department: "Engineering", impact: 1, stress: 1, dueDate: null }),
      ],
      todayDate,
    );
    const chart = debtByDepartment(summary.open);
    expect(chart.hasDepartmentData).toBe(true);
    expect(chart.segments.reduce((sum, segment) => sum + segment.debt, 0)).toBe(chart.totalDebt);
    expect(chart.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
    expect(debtByDepartment([]).segments).toEqual([]);
    expect(debtByDepartment(summarize([stored({ department: null })], todayDate).open).hasDepartmentData).toBe(false);
    expect(percentChange(12, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
  });

  it("ranks attention deterministically and waits for real trend history", () => {
    const summary = summarize(
      [
        stored({ id: "low", dueDate: null, impact: 1, stress: 1, createdDate: "2026-10-14" }),
        stored({ id: "late", dueDate: "2026-10-01", impact: 2, stress: 2 }),
      ],
      todayDate,
    );
    expect(needsAttention(summary.open, 1)[0].id).toBe("late");
    const snapshots = upsertSnapshot([], { date: today, totalDebt: summary.totalDebt, openCount: 2, overdueCount: 1 });
    expect(trendReady(snapshots)).toBe(false);
    const withHistory = upsertSnapshot(snapshots, { date: "2026-09-15", totalDebt: 10, openCount: 1, overdueCount: 0 });
    expect(trendReady(withHistory)).toBe(true);
    expect(priorSnapshot(withHistory, today, 30)?.date).toBe("2026-09-15");
  });

  it("keeps the existing web score for a 30-day decision", () => {
    const score = computeDebt({
      createdDate: "2026-01-14",
      dueDate: null,
      impact: 5,
      stress: 5,
      today: new Date(2026, 1, 13, 12),
    });
    expect(score.daysOpen).toBe(30);
    expect(score.debt).toBe(93);
    expect(score.invalid).toBe(false);
  });
});
