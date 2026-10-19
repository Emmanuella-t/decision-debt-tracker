import { BLOCKER_TYPES, EVIDENCE_STATUS_LABELS, blockerGuide } from "../blockers";
import {
  DECISIONS_STORAGE_KEY,
  LEGACY_DECISIONS_STORAGE_KEY,
  QUARANTINE_STORAGE_KEY,
  SNAPSHOTS_STORAGE_KEY,
  V2_DECISIONS_STORAGE_KEY,
} from "../constants";
import { compareISODate, diffISODays, formatDisplayDate, isRealDate, localTodayISO } from "../dates";
import { blockerOpenItems } from "../readiness";
import { computeDebt, type DebtBreakdown } from "../scoring";
import {
  SCHEMA_VERSION,
  type ActionDraft,
  type Blocker,
  type BlockerDraft,
  type BlockerType,
  type ClearedHow,
  type Decision,
  type DecisionDraft,
  type DecisionStage,
  type Evidence,
  type EvidenceDraft,
  type EvidenceSourceType,
  type EvidenceStatus,
  type LifecycleEvent,
  type LifecycleEventType,
  type NextAction,
  type Reversibility,
  type Snapshot,
  type Urgency,
  type WorkItem,
} from "../types";
import {
  EVIDENCE_SOURCES,
  EVIDENCE_STATUSES,
  REVERSIBILITIES,
  STAGES,
  URGENCIES,
  DecisionValidationError,
  cleanDraft,
  cleanText,
  CLEARING_EXPLANATION_MIN,
  hasErrors,
  isClearingExplanation,
  parseExposure,
  safeUrl,
  validateDecision,
  validateReopenReason,
} from "../validation";

export type {
  Blocker,
  Decision,
  DecisionDraft,
  DecisionStage,
  DecisionStatus,
  Evidence,
  LifecycleEvent,
  Snapshot,
} from "../types";

export type DecisionComputed = Decision & DebtBreakdown & { scored: boolean };

type MemoryStorage = Pick<Storage, "getItem" | "setItem">;

function storageOrNull(storage?: MemoryStorage): MemoryStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function newId(): string {
  return crypto.randomUUID();
}

const EVENT_TYPES: LifecycleEventType[] = [
  "created",
  "updated",
  "stage_changed",
  "blocker_added",
  "blocker_updated",
  "blocker_removed",
  "blocker_resolved",
  "action_added",
  "action_linked",
  "action_completed",
  "evidence_added",
  "evidence_updated",
  "evidence_status_changed",
  "readiness_noted",
  "resolved",
  "reopened",
];

const CLEARED_HOW: ClearedHow[] = ["criteria_met", "not_applicable", "override"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readEvent(value: unknown): LifecycleEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<LifecycleEvent>;
  if (!EVENT_TYPES.includes(event.type as LifecycleEventType) || typeof event.at !== "string") return null;
  return {
    type: event.type as LifecycleEventType,
    at: event.at,
    ...(typeof event.note === "string" ? { note: event.note } : {}),
    ...(typeof event.detail === "string" ? { detail: event.detail } : {}),
  };
}

function readBlocker(value: unknown): Blocker | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Blocker>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!BLOCKER_TYPES.includes(raw.type as BlockerType)) return null;
  const status = raw.status === "resolved" ? "resolved" : raw.status === "active" ? "active" : null;
  if (!status) return null;
  const type = raw.type as BlockerType;
  const allowed = new Set(blockerGuide(type).followUps.map((question) => question.key));
  const details: Record<string, string> = {};
  if (raw.details && typeof raw.details === "object") {
    for (const [key, answer] of Object.entries(raw.details)) {
      if (allowed.has(key) && typeof answer === "string" && answer.trim()) details[key] = answer;
    }
  }
  const unknowns = Array.isArray(raw.unknowns) ? raw.unknowns.filter((key): key is string => typeof key === "string" && allowed.has(key)) : [];
  return {
    id: raw.id,
    type,
    description: str(raw.description),
    details,
    unknowns: [...new Set(unknowns)],
    owner: str(raw.owner),
    followUpDate: textOrNull(raw.followUpDate),
    dependsOnDecisionId: type === "dependency" ? textOrNull(raw.dependsOnDecisionId) : null,
    identifiedDate: str(raw.identifiedDate),
    resolvesWhen: str(raw.resolvesWhen),
    status,
    resolvedDate: status === "resolved" ? textOrNull(raw.resolvedDate) : null,
    resolutionNote: textOrNull(raw.resolutionNote),
    clearedHow: status === "resolved" && CLEARED_HOW.includes(raw.clearedHow as ClearedHow) ? (raw.clearedHow as ClearedHow) : null,
  };
}

function readWorkItem(value: unknown): WorkItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WorkItem>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string") return null;
  return { id: raw.id, title: raw.title };
}

function readAction(value: unknown): NextAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<NextAction>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.description !== "string") return null;
  const done = raw.done === true;
  return {
    id: raw.id,
    description: raw.description,
    owner: str(raw.owner),
    followUpDate: textOrNull(raw.followUpDate),
    done,
    completedDate: done ? textOrNull(raw.completedDate) : null,
    createdDate: str(raw.createdDate),
    blockerId: textOrNull(raw.blockerId),
    suggestionKey: textOrNull(raw.suggestionKey),
  };
}

function readEvidence(value: unknown): Evidence | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Evidence>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string") return null;
  if (!EVIDENCE_SOURCES.includes(raw.sourceType as EvidenceSourceType)) return null;
  if (!EVIDENCE_STATUSES.includes(raw.status as EvidenceStatus)) return null;
  const link = typeof raw.url === "string" ? safeUrl(raw.url) : { url: null, error: null };
  if (link.error) return null;
  return {
    id: raw.id,
    blockerId: textOrNull(raw.blockerId),
    title: raw.title,
    question: str(raw.question),
    sourceType: raw.sourceType as EvidenceSourceType,
    sourceName: str(raw.sourceName),
    url: link.url,
    collectedDate: textOrNull(raw.collectedDate),
    summary: str(raw.summary),
    limitations: str(raw.limitations),
    status: raw.status as EvidenceStatus,
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

function readList<T>(value: unknown, read: (item: unknown) => T | null): { items: T[]; lossy: boolean } {
  if (value === undefined) return { items: [], lossy: false };
  if (!Array.isArray(value)) return { items: [], lossy: true };
  const items = value.map(read).filter((item): item is T => item !== null);
  return { items, lossy: items.length !== value.length };
}

/**
 * Reads a v1, v2, or v3 record. New fields get safe defaults so older
 * decisions stay readable and keep the same debt score. `lossy` means part of
 * the record could not be read and the raw copy should be kept.
 */
export function normalizeStoredDecision(raw: unknown): { decision: Decision; lossy: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id || typeof value.title !== "string") return null;

  const resolvedDate = textOrNull(value.resolvedDate);
  const storedStage = value.stage as DecisionStage;
  const stage: DecisionStage = resolvedDate
    ? "resolved"
    : STAGES.includes(storedStage) && storedStage !== "resolved"
      ? storedStage
      : "new";

  const blockers = readList(value.blockers, readBlocker);
  const blockedWork = readList(value.blockedWork, readWorkItem);
  const actions = readList(value.actions, readAction);
  const evidence = readList(value.evidence, readEvidence);
  const events = readList(value.events, readEvent);

  // Links to blockers that are gone are cleared instead of left dangling.
  const blockerIds = new Set(blockers.items.map((blocker) => blocker.id));
  const linkedActions = actions.items.map((action) =>
    action.blockerId && !blockerIds.has(action.blockerId) ? { ...action, blockerId: null } : action,
  );
  const linkedEvidence = evidence.items.map((item) =>
    item.blockerId && !blockerIds.has(item.blockerId) ? { ...item, blockerId: null } : item,
  );

  const dismissed = Array.isArray(value.dismissedSuggestions)
    ? value.dismissedSuggestions.filter((key): key is string => typeof key === "string")
    : [];
  const override = value.readinessOverride as { reason?: unknown; at?: unknown } | null | undefined;
  const readinessOverride =
    !resolvedDate && override && typeof override.reason === "string" && override.reason.trim() && typeof override.at === "string"
      ? { reason: override.reason, at: override.at }
      : null;

  const exposure = typeof value.exposure === "number" && Number.isFinite(value.exposure) && value.exposure >= 0 ? value.exposure : null;

  return {
    decision: {
      schemaVersion: SCHEMA_VERSION,
      id: value.id,
      title: value.title,
      description: str(value.description),
      category: str(value.category),
      department: typeof value.department === "string" && value.department.trim() ? value.department : null,
      owner: str(value.owner),
      impact: readRating(value.impact),
      stress: readRating(value.stress),
      urgency: URGENCIES.includes(value.urgency as Urgency) ? (value.urgency as Urgency) : null,
      reversibility: REVERSIBILITIES.includes(value.reversibility as Reversibility)
        ? (value.reversibility as Reversibility)
        : null,
      exposure,
      createdDate: str(value.createdDate),
      dueDate: textOrNull(value.dueDate),
      stage,
      resolvedDate,
      resolutionNote: typeof value.resolutionNote === "string" ? value.resolutionNote : null,
      blockers: blockers.items,
      blockedWork: blockedWork.items,
      actions: linkedActions,
      evidence: linkedEvidence,
      dismissedSuggestions: [...new Set(dismissed)],
      readinessOverride,
      events: events.items,
    },
    lossy: blockers.lossy || blockedWork.lossy || actions.lossy || evidence.lossy || events.lossy,
  };
}

/** Null is a deliberate "not rated". A missing or malformed value stays unscorable (NaN), as before. */
function readRating(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number.NaN;
}

export type QuarantineEntry = { at: string; reason: string; raw: string };

export type LoadResult = {
  decisions: Decision[];
  /** Earlier schema the decisions were upgraded from on this load, if any. */
  migratedFrom: 1 | 2 | null;
  quarantined: number;
  storeUnreadable: boolean;
};

function appendQuarantine(target: MemoryStorage, entries: QuarantineEntry[]) {
  if (entries.length === 0) return;
  let existing: QuarantineEntry[] = [];
  try {
    const parsed = JSON.parse(target.getItem(QUARANTINE_STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }
  target.setItem(QUARANTINE_STORAGE_KEY, JSON.stringify([...existing, ...entries]));
}

function readRecords(list: unknown[], at: string) {
  const decisions: Decision[] = [];
  const quarantine: QuarantineEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const result = normalizeStoredDecision(item);
    if (!result) {
      quarantine.push({ at, reason: "Unreadable decision", raw: JSON.stringify(item) ?? String(item) });
      continue;
    }
    if (seen.has(result.decision.id)) {
      quarantine.push({ at, reason: "Duplicate decision id", raw: JSON.stringify(item) });
      continue;
    }
    seen.add(result.decision.id);
    if (result.lossy) quarantine.push({ at, reason: "Part of this decision could not be read", raw: JSON.stringify(item) });
    decisions.push(result.decision);
  }
  // Dependency links to decisions that aren't in the store are cleared.
  const ids = new Set(decisions.map((decision) => decision.id));
  const linked = decisions.map((decision) =>
    decision.blockers.some((blocker) => blocker.dependsOnDecisionId && !ids.has(blocker.dependsOnDecisionId))
      ? {
          ...decision,
          blockers: decision.blockers.map((blocker) =>
            blocker.dependsOnDecisionId && !ids.has(blocker.dependsOnDecisionId) ? { ...blocker, dependsOnDecisionId: null } : blocker,
          ),
        }
      : decision,
  );
  return { decisions: linked, quarantine };
}

function readStore(raw: string, label: string, at: string, target: MemoryStorage) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    appendQuarantine(target, [{ at, reason: `${label} could not be parsed`, raw }]);
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { decisions?: unknown }).decisions)
      ? (parsed as { decisions: unknown[] }).decisions
      : null;
  if (!list) {
    appendQuarantine(target, [{ at, reason: `${label} had an unexpected shape`, raw }]);
    return null;
  }
  const { decisions, quarantine } = readRecords(list, at);
  appendQuarantine(target, quarantine);
  return { decisions, quarantined: quarantine.length };
}

/**
 * Loads the newest store that exists. An older store is migrated once into
 * the current key. Older keys are never modified or deleted, so they stay
 * available as backups.
 */
export function loadDecisionStore(storage?: MemoryStorage, now = new Date()): LoadResult {
  const target = storageOrNull(storage);
  const empty: LoadResult = { decisions: [], migratedFrom: null, quarantined: 0, storeUnreadable: false };
  if (!target) return empty;
  const at = now.toISOString();

  const sources: { key: string; label: string; version: 1 | 2 | null }[] = [
    { key: DECISIONS_STORAGE_KEY, label: "Decision store", version: null },
    { key: V2_DECISIONS_STORAGE_KEY, label: "Version 2 store", version: 2 },
    { key: LEGACY_DECISIONS_STORAGE_KEY, label: "Version 1 store", version: 1 },
  ];
  for (const source of sources) {
    const raw = target.getItem(source.key);
    if (raw === null) continue;
    const result = readStore(raw, source.label, at, target);
    if (!result) return { ...empty, quarantined: 1, storeUnreadable: true };
    if (source.version !== null) saveDecisions(result.decisions, target);
    return { decisions: result.decisions, migratedFrom: source.version, quarantined: result.quarantined, storeUnreadable: false };
  }
  return empty;
}

export function loadDecisions(storage?: MemoryStorage): Decision[] {
  return loadDecisionStore(storage).decisions;
}

export function saveDecisions(decisions: Decision[], storage?: MemoryStorage) {
  const target = storageOrNull(storage);
  if (!target) return;
  const ids = new Set<string>();
  for (const decision of decisions) {
    if (ids.has(decision.id)) throw new Error(`Refusing to save two decisions with the id ${decision.id}.`);
    ids.add(decision.id);
  }
  target.setItem(DECISIONS_STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, decisions }));
}

export function loadSnapshots(storage?: MemoryStorage): Snapshot[] {
  const target = storageOrNull(storage);
  if (!target) return [];
  const raw = target.getItem(SNAPSHOTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Snapshot =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as Snapshot).date === "string" &&
        isRealDate((item as Snapshot).date) &&
        Number.isFinite((item as Snapshot).totalDebt),
    );
  } catch {
    return [];
  }
}

export function saveSnapshots(snapshots: Snapshot[], storage?: MemoryStorage) {
  const target = storageOrNull(storage);
  if (!target) return;
  target.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
}

export function emptyDraft(today: string): DecisionDraft {
  return {
    title: "",
    description: "",
    category: "",
    department: "",
    owner: "",
    impact: null,
    stress: null,
    urgency: "",
    reversibility: "",
    exposure: "",
    createdDate: today,
    dueDate: "",
    stage: "new",
    resolvedDate: "",
    resolutionNote: "",
    blockers: [],
    blockedWork: [],
    actions: [],
    evidence: [],
    dismissedSuggestions: [],
    readinessOverride: "",
  };
}

/**
 * The draft Quick Start saves: the person's own words and, if chosen, a
 * blocker of that category with no invented description. Everything else
 * is unset and goes through the same validation as the full form.
 */
export function quickStartDraft(input: { title: string; blockerType: BlockerType | null }, today: string): DecisionDraft {
  return {
    ...emptyDraft(today),
    title: input.title,
    blockers: input.blockerType ? [newBlockerDraft(input.blockerType, today)] : [],
  };
}

export function newBlockerDraft(type: BlockerType, today: string): BlockerDraft {
  return {
    id: newId(),
    type,
    description: "",
    details: {},
    unknowns: [],
    owner: "",
    followUpDate: "",
    dependsOnDecisionId: "",
    identifiedDate: today,
    resolvesWhen: "",
    status: "active",
    resolvedDate: "",
    resolutionNote: "",
    clearedHow: "",
  };
}

export function newActionDraft(today: string, overrides: Partial<ActionDraft> = {}): ActionDraft {
  return {
    id: newId(),
    description: "",
    owner: "",
    followUpDate: "",
    done: false,
    completedDate: "",
    createdDate: today,
    blockerId: "",
    suggestionKey: "",
    ...overrides,
  };
}

export function newEvidenceDraft(blockerId: string, overrides: Partial<EvidenceDraft> = {}): EvidenceDraft {
  return {
    id: newId(),
    blockerId,
    title: "",
    question: "",
    sourceType: "document",
    sourceName: "",
    url: "",
    collectedDate: "",
    summary: "",
    limitations: "",
    status: "unverified",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

export function newWorkItem(title: string): WorkItem {
  return { id: newId(), title };
}

export function decisionToDraft(decision: Decision): DecisionDraft {
  return {
    title: decision.title,
    description: decision.description,
    category: decision.category,
    department: decision.department ?? "",
    owner: decision.owner,
    impact: decision.impact,
    stress: decision.stress,
    urgency: decision.urgency ?? "",
    reversibility: decision.reversibility ?? "",
    exposure: decision.exposure === null ? "" : String(decision.exposure),
    createdDate: decision.createdDate,
    dueDate: decision.dueDate ?? "",
    stage: decision.stage,
    resolvedDate: decision.resolvedDate ?? "",
    resolutionNote: decision.resolutionNote ?? "",
    blockers: decision.blockers.map((blocker) => ({
      ...blocker,
      details: { ...blocker.details },
      unknowns: [...blocker.unknowns],
      followUpDate: blocker.followUpDate ?? "",
      dependsOnDecisionId: blocker.dependsOnDecisionId ?? "",
      resolvedDate: blocker.resolvedDate ?? "",
      resolutionNote: blocker.resolutionNote ?? "",
      clearedHow: blocker.clearedHow ?? "",
    })),
    blockedWork: decision.blockedWork.map((item) => ({ ...item })),
    actions: decision.actions.map((action) => ({
      ...action,
      followUpDate: action.followUpDate ?? "",
      completedDate: action.completedDate ?? "",
      blockerId: action.blockerId ?? "",
      suggestionKey: action.suggestionKey ?? "",
    })),
    evidence: decision.evidence.map((item) => ({
      ...item,
      blockerId: item.blockerId ?? "",
      url: item.url ?? "",
      collectedDate: item.collectedDate ?? "",
    })),
    dismissedSuggestions: [...decision.dismissedSuggestions],
    readinessOverride: decision.readinessOverride?.reason ?? "",
  };
}

function validRating(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 1 && value <= 5);
}

/** Impact and stress were both given by the person. */
export function hasRatings(decision: Pick<Decision, "impact" | "stress">): boolean {
  return decision.impact !== null && decision.stress !== null;
}

/** Dates and ratings can be read. Unrated is valid; malformed is not. */
export function isValidRecord(decision: Decision): boolean {
  return (
    isRealDate(decision.createdDate) &&
    validRating(decision.impact) &&
    validRating(decision.stress) &&
    (!decision.dueDate || isRealDate(decision.dueDate))
  );
}

/** Valid and rated, so the existing debt formula applies unchanged. */
export function isScorable(decision: Decision): boolean {
  return isValidRecord(decision) && hasRatings(decision);
}

function dateFromISO(value: string): Date | null {
  if (!isRealDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Adds the debt score. An unrated decision gets `scored: false` and debt 0
 * for sorting only; its days open and overdue days are still real.
 */
export function withDebt(decision: Decision, today: Date): DecisionComputed {
  const asOf = decision.resolvedDate ? dateFromISO(decision.resolvedDate) ?? today : today;
  if (!hasRatings(decision)) {
    const todayISO = localTodayISO(asOf);
    const open = diffISODays(decision.createdDate, todayISO);
    const late = decision.dueDate ? diffISODays(decision.dueDate, todayISO) : 0;
    return {
      ...decision,
      debt: 0,
      daysOpen: Math.max(0, open ?? 0),
      overdueDays: Math.max(0, late ?? 0),
      invalid: open === null || late === null,
      scored: false,
    };
  }
  const breakdown = computeDebt({
    createdDate: decision.createdDate,
    dueDate: decision.dueDate,
    impact: decision.impact as number,
    stress: decision.stress as number,
    today: asOf,
  });
  return { ...decision, ...breakdown, scored: !breakdown.invalid };
}

export function activeBlockers(decision: Pick<Decision, "blockers">): Blocker[] {
  return decision.blockers.filter((blocker) => blocker.status === "active");
}

export function isBlocked(decision: Pick<Decision, "blockers" | "resolvedDate">): boolean {
  return !decision.resolvedDate && activeBlockers(decision).length > 0;
}

export function actionsFor(decision: Pick<Decision, "actions">, blockerId: string): NextAction[] {
  return decision.actions.filter((action) => action.blockerId === blockerId);
}

export function evidenceFor(decision: Pick<Decision, "evidence">, blockerId: string): Evidence[] {
  return decision.evidence.filter((item) => item.blockerId === blockerId);
}

function toBlocker(draft: BlockerDraft): Blocker {
  const resolved = draft.status === "resolved";
  return {
    ...draft,
    details: { ...draft.details },
    unknowns: [...draft.unknowns],
    followUpDate: draft.followUpDate || null,
    dependsOnDecisionId: draft.type === "dependency" ? draft.dependsOnDecisionId || null : null,
    resolvedDate: resolved ? draft.resolvedDate : null,
    resolutionNote: resolved ? draft.resolutionNote || null : null,
    clearedHow: resolved ? draft.clearedHow || null : null,
  };
}

function blockerContentChanged(before: Blocker, after: Blocker): boolean {
  return (
    before.type !== after.type ||
    before.description !== after.description ||
    before.owner !== after.owner ||
    before.resolvesWhen !== after.resolvesWhen ||
    before.followUpDate !== after.followUpDate ||
    before.dependsOnDecisionId !== after.dependsOnDecisionId ||
    JSON.stringify(before.details) !== JSON.stringify(after.details) ||
    JSON.stringify([...before.unknowns].sort()) !== JSON.stringify([...after.unknowns].sort())
  );
}

const CLEARED_LABELS: Record<ClearedHow, string> = {
  criteria_met: "Clearing criteria met",
  not_applicable: "Clearing criteria didn't apply",
  override: "Cleared before the criteria were met",
};

function blockerNote(blocker: Pick<Blocker, "description" | "type">): string {
  return blocker.description || blockerGuide(blocker.type).label;
}

function evidenceNote(item: Pick<Evidence, "title" | "summary" | "question">): string {
  const text = (item.title || item.summary || item.question).trim().replace(/\s+/g, " ");
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

/** A date the person typed, labeled so it isn't mistaken for when the change was saved. */
function enteredDate(what: string, date: string): string {
  return `${what} date entered as ${formatDisplayDate(date)}.`;
}

/** Items still open on a blocker when it's cleared, without the criteria check (the clearing method covers that). */
export function clearanceWarnings(decision: Pick<Decision, "blockers" | "actions" | "evidence" | "resolvedDate" | "readinessOverride">, blocker: Blocker): string[] {
  return blockerOpenItems(decision, blocker).filter((item) => !item.startsWith("No clearing criteria"));
}

function clearanceDetail(blocker: Blocker, records: { actions: NextAction[]; evidence: Evidence[] }, today: string): { detail?: string } {
  const how = blocker.clearedHow ? CLEARED_LABELS[blocker.clearedHow] : null;
  const open = clearanceWarnings({ blockers: [], ...records, resolvedDate: null, readinessOverride: null }, blocker);
  const parts = [
    how && blocker.resolutionNote ? `${how}: ${blocker.resolutionNote}` : how || blocker.resolutionNote,
    open.length ? `Still open when cleared: ${open.join(" ")}` : null,
    blocker.resolvedDate && blocker.resolvedDate !== today ? enteredDate("Cleared", blocker.resolvedDate) : null,
  ].filter(Boolean);
  if (!parts.length) return {};
  return { detail: parts.map((part, index) => (index < parts.length - 1 && !/[.!?]$/.test(part as string) ? `${part}.` : part)).join(" ") };
}

function sameScalars(a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

const DECISION_FIELDS = [
  "title",
  "description",
  "category",
  "department",
  "owner",
  "impact",
  "stress",
  "urgency",
  "reversibility",
  "exposure",
  "createdDate",
  "dueDate",
];

export function applyDraft(existing: Decision | null, draft: DecisionDraft, today: string, now = new Date().toISOString()): Decision {
  const cleaned = cleanDraft(draft);
  const events: LifecycleEvent[] = [...(existing?.events ?? [])];
  const before = existing?.events.length ?? 0;

  // Cleared blockers are history. An edit can't drop them.
  const draftIds = new Set(cleaned.blockers.map((blocker) => blocker.id));
  const keptHistory = (existing?.blockers ?? []).filter(
    (blocker) => blocker.status === "resolved" && !draftIds.has(blocker.id),
  );
  const blockers = [...cleaned.blockers.map(toBlocker), ...keptHistory];
  const blockerIds = new Set(blockers.map((blocker) => blocker.id));

  // Steps and evidence of a removed blocker are kept, just unlinked.
  const priorActions = new Map((existing?.actions ?? []).map((action) => [action.id, action]));
  const actions: NextAction[] = cleaned.actions.map((action) => ({
    ...action,
    followUpDate: action.followUpDate || null,
    // A step finished before completion dates were recorded keeps no date rather than a made-up one.
    completedDate: action.done ? action.completedDate || (priorActions.get(action.id)?.done ? null : today) : null,
    blockerId: action.blockerId && blockerIds.has(action.blockerId) ? action.blockerId : null,
    suggestionKey: action.suggestionKey || null,
  }));
  const previousEvidence = new Map((existing?.evidence ?? []).map((item) => [item.id, item]));
  const evidence: Evidence[] = cleaned.evidence.map((item) => {
    const previous = previousEvidence.get(item.id);
    const next: Evidence = {
      ...item,
      blockerId: item.blockerId && blockerIds.has(item.blockerId) ? item.blockerId : null,
      url: safeUrl(item.url).url,
      collectedDate: item.collectedDate || null,
      createdAt: previous?.createdAt || item.createdAt || now,
      updatedAt: previous?.updatedAt || item.updatedAt || now,
    };
    const unlinkedOnly = Boolean(previous?.blockerId && !blockerIds.has(previous.blockerId));
    if (previous && !sameScalars(previous, next, [...(unlinkedOnly ? [] : ["blockerId"]), "title", "question", "sourceType", "sourceName", "url", "collectedDate", "summary", "limitations", "status"])) {
      next.updatedAt = now;
    }
    return next;
  });

  const describe = (id: string | null) => blockers.find((blocker) => blocker.id === id)?.description || "a blocker";

  if (!existing) {
    events.push({ type: "created", at: now });
    for (const blocker of blockers) events.push({ type: "blocker_added", at: now, note: blockerNote(blocker) });
    for (const action of actions) {
      events.push({ type: "action_added", at: now, note: action.description, ...(action.blockerId ? { detail: `For: ${describe(action.blockerId)}` } : {}) });
    }
  } else {
    const oldBlockers = new Map(existing.blockers.map((blocker) => [blocker.id, blocker]));
    for (const blocker of blockers) {
      const previous = oldBlockers.get(blocker.id);
      if (!previous) {
        events.push({ type: "blocker_added", at: now, note: blockerNote(blocker) });
      } else if (blocker.status === "active" && blockerContentChanged(previous, blocker)) {
        events.push({ type: "blocker_updated", at: now, note: blockerNote(blocker) });
      }
      if (blocker.status === "resolved" && previous?.status !== "resolved") {
        events.push({ type: "blocker_resolved", at: now, note: blockerNote(blocker), ...clearanceDetail(blocker, { actions, evidence }, today) });
      }
    }
    for (const blocker of existing.blockers) {
      if (!blockerIds.has(blocker.id)) {
        const kept = existing.actions.filter((action) => action.blockerId === blocker.id).length;
        const keptEvidence = existing.evidence.filter((item) => item.blockerId === blocker.id).length;
        events.push({
          type: "blocker_removed",
          at: now,
          note: blockerNote(blocker),
          ...(kept || keptEvidence ? { detail: `Kept ${kept} linked steps and ${keptEvidence} evidence entries, now unlinked.` } : {}),
        });
      }
    }

    const oldActions = new Map(existing.actions.map((action) => [action.id, action]));
    for (const action of actions) {
      const previous = oldActions.get(action.id);
      if (!previous) {
        events.push({ type: "action_added", at: now, note: action.description, ...(action.blockerId ? { detail: `For: ${describe(action.blockerId)}` } : {}) });
      } else if (action.blockerId && action.blockerId !== previous.blockerId) {
        events.push({ type: "action_linked", at: now, note: action.description, detail: `For: ${describe(action.blockerId)}` });
      }
      if (action.done && !previous?.done) {
        events.push({
          type: "action_completed",
          at: now,
          note: action.description,
          ...(action.completedDate && action.completedDate !== today ? { detail: enteredDate("Completed", action.completedDate) } : {}),
        });
      }
    }

    for (const item of evidence) {
      const previous = previousEvidence.get(item.id);
      if (!previous) {
        events.push({ type: "evidence_added", at: now, note: evidenceNote(item) });
      } else if (previous.status !== item.status) {
        events.push({ type: "evidence_status_changed", at: now, note: evidenceNote(item), detail: EVIDENCE_STATUS_LABELS[item.status] });
      } else if (item.updatedAt !== previous.updatedAt) {
        events.push({ type: "evidence_updated", at: now, note: evidenceNote(item) });
      }
    }

    if (cleaned.readinessOverride && cleaned.readinessOverride !== existing.readinessOverride?.reason) {
      events.push({ type: "readiness_noted", at: now, note: cleaned.readinessOverride });
    } else if (!cleaned.readinessOverride && existing.readinessOverride && cleaned.stage !== "resolved") {
      events.push({ type: "readiness_noted", at: now, note: "Readiness note removed." });
    }

    const wasResolved = Boolean(existing.resolvedDate);
    if (!wasResolved && cleaned.stage === "resolved") {
      events.push({
        type: "resolved",
        at: now,
        note: cleaned.resolutionNote,
        ...(cleaned.resolvedDate !== today ? { detail: enteredDate("Decided", cleaned.resolvedDate) } : {}),
      });
    } else if (existing.stage !== cleaned.stage) {
      events.push({ type: "stage_changed", at: now, note: `${existing.stage} → ${cleaned.stage}` });
    }

    const fieldsChanged = !sameScalars(
      existing as unknown as Record<string, unknown>,
      {
        ...cleaned,
        department: cleaned.department || null,
        urgency: cleaned.urgency || null,
        reversibility: cleaned.reversibility || null,
        exposure: parseExposure(cleaned.exposure).value,
        dueDate: cleaned.dueDate || null,
      } as unknown as Record<string, unknown>,
      DECISION_FIELDS,
    );
    const workChanged = JSON.stringify(existing.blockedWork) !== JSON.stringify(cleaned.blockedWork);
    const actionsEdited = actions.some((action) => {
      const previous = oldActions.get(action.id);
      return previous && (previous.description !== action.description || previous.owner !== action.owner || previous.followUpDate !== action.followUpDate);
    });
    if (events.length === before && (fieldsChanged || workChanged || actionsEdited || actions.length !== existing.actions.length)) {
      events.push({ type: "updated", at: now });
    }
  }

  const resolved = cleaned.stage === "resolved";
  const existingOverride = existing?.readinessOverride;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: existing?.id ?? newId(),
    title: cleaned.title,
    description: cleaned.description,
    category: cleaned.category,
    department: cleaned.department || null,
    owner: cleaned.owner,
    impact: cleaned.impact,
    stress: cleaned.stress,
    urgency: cleaned.urgency || null,
    reversibility: cleaned.reversibility || null,
    exposure: parseExposure(cleaned.exposure).value,
    createdDate: cleaned.createdDate,
    dueDate: cleaned.dueDate || null,
    stage: cleaned.stage,
    resolvedDate: resolved ? cleaned.resolvedDate : null,
    resolutionNote: resolved ? cleaned.resolutionNote : null,
    blockers,
    blockedWork: cleaned.blockedWork,
    actions,
    evidence,
    dismissedSuggestions: [...new Set(cleaned.dismissedSuggestions)],
    readinessOverride:
      !resolved && cleaned.readinessOverride
        ? existingOverride && existingOverride.reason === cleaned.readinessOverride
          ? existingOverride
          : { reason: cleaned.readinessOverride, at: today }
        : null,
    events,
  };
}

export function commitDecision(
  decisions: Decision[],
  draft: DecisionDraft,
  options: { today: string; id?: string; now?: string },
): Decision[] {
  const existing = options.id ? decisions.find((item) => item.id === options.id) ?? null : null;
  if (options.id && !existing) {
    throw new DecisionValidationError({ title: "That decision could not be found." });
  }
  const cleaned = cleanDraft(draft);
  const result = validateDecision(cleaned, {
    today: options.today,
    decisions,
    ignoreId: existing?.id,
  });
  // A blocker cleared in this change must say how. Older cleared blockers may not.
  const previouslyCleared = new Set((existing?.blockers ?? []).filter((b) => b.status === "resolved").map((b) => b.id));
  cleaned.blockers.forEach((blocker, index) => {
    if (blocker.status === "resolved" && !previouslyCleared.has(blocker.id) && !blocker.clearedHow) {
      result.errors[`blockers.${index}.clearedHow`] = "Say whether the clearing criteria were met before clearing this blocker.";
    }
    if (
      blocker.status === "resolved" &&
      !previouslyCleared.has(blocker.id) &&
      (blocker.clearedHow === "override" || blocker.clearedHow === "not_applicable") &&
      !isClearingExplanation(blocker.resolutionNote)
    ) {
      result.errors[`blockers.${index}.resolutionNote`] =
        blocker.clearedHow === "override"
          ? `Explain why you're clearing it before the criteria are met (at least ${CLEARING_EXPLANATION_MIN} characters).`
          : `Explain why the clearing criteria don't apply (at least ${CLEARING_EXPLANATION_MIN} characters).`;
    }
  });
  if (hasErrors(result)) throw new DecisionValidationError(result.errors);
  const next = applyDraft(existing, draft, options.today, options.now);
  // "Criteria met" while steps or evidence are still open needs the person to say why.
  const acknowledgement: Record<string, string> = {};
  cleaned.blockers.forEach((blocker, index) => {
    if (blocker.status !== "resolved" || previouslyCleared.has(blocker.id) || blocker.clearedHow !== "criteria_met") return;
    const saved = next.blockers.find((item) => item.id === blocker.id);
    if (saved && clearanceWarnings(next, saved).length > 0 && !isClearingExplanation(blocker.resolutionNote)) {
      acknowledgement[`blockers.${index}.resolutionNote`] = "Some items are still open. Explain why the criteria are met anyway.";
    }
  });
  if (Object.keys(acknowledgement).length > 0) throw new DecisionValidationError(acknowledgement);
  if (!existing) {
    if (decisions.some((item) => item.id === next.id)) {
      throw new DecisionValidationError({ title: "A decision with this identifier already exists." });
    }
    return [next, ...decisions];
  }
  return decisions.map((item) => (item.id === existing.id ? next : item));
}

/**
 * Builds the draft for resolving a decision. Active blockers are closed with
 * the decision only when the caller passes `closeBlockers`, which the UI sets
 * after the person confirms it.
 */
export function resolutionDraft(
  decision: Decision,
  input: { resolvedDate: string; outcome: string; closeBlockers: boolean },
): DecisionDraft {
  const draft = decisionToDraft(decision);
  draft.stage = "resolved";
  draft.resolvedDate = input.resolvedDate;
  draft.resolutionNote = input.outcome;
  draft.readinessOverride = "";
  if (input.closeBlockers) {
    draft.blockers = draft.blockers.map((blocker) =>
      blocker.status === "active"
        ? {
            ...blocker,
            status: "resolved",
            resolvedDate: input.resolvedDate,
            resolutionNote: "Closed when the decision was resolved.",
            clearedHow: "override",
          }
        : blocker,
    );
  }
  return draft;
}

/** Removes a blocker from a draft. Its steps and evidence stay, unlinked. */
export function removeBlockerFromDraft(draft: DecisionDraft, blockerId: string): DecisionDraft {
  return {
    ...draft,
    blockers: draft.blockers.filter((blocker) => blocker.id !== blockerId),
    actions: draft.actions.map((action) => (action.blockerId === blockerId ? { ...action, blockerId: "" } : action)),
    evidence: draft.evidence.map((item) => (item.blockerId === blockerId ? { ...item, blockerId: "" } : item)),
  };
}

/** Builds the draft for clearing one blocker. Validation decides whether it can be saved. */
export function clearBlockerDraft(
  decision: Decision,
  blockerId: string,
  input: { clearedHow: ClearedHow; reason: string; resolvedDate: string },
): DecisionDraft {
  const draft = decisionToDraft(decision);
  const index = draft.blockers.findIndex((blocker) => blocker.id === blockerId);
  if (index < 0 || draft.blockers[index].status !== "active") {
    throw new DecisionValidationError({ blockers: "That blocker is not active." });
  }
  draft.blockers[index] = {
    ...draft.blockers[index],
    status: "resolved",
    resolvedDate: input.resolvedDate,
    resolutionNote: input.reason,
    clearedHow: input.clearedHow,
  };
  return draft;
}

export function reopenDecision(decisions: Decision[], id: string, reason: string, today: string, now = new Date().toISOString()): Decision[] {
  const existing = decisions.find((item) => item.id === id);
  if (!existing) throw new DecisionValidationError({ reason: "That decision could not be found." });
  if (!existing.resolvedDate) throw new DecisionValidationError({ reason: "This decision is already open." });
  const reasonError = validateReopenReason(reason);
  if (reasonError) throw new DecisionValidationError({ reason: reasonError });
  if (compareISODate(today, existing.createdDate) === -1) {
    throw new DecisionValidationError({ reason: "The decision's created date is after today. Edit the date first." });
  }
  const next: Decision = {
    ...existing,
    stage: "under_review",
    resolvedDate: null,
    resolutionNote: null,
    events: [
      ...existing.events,
      {
        type: "reopened",
        at: now,
        note: cleanText(reason),
        detail: existing.resolutionNote ? `Previous outcome: ${existing.resolutionNote}` : undefined,
      },
    ],
  };
  return decisions.map((item) => (item.id === id ? next : item));
}

/** Work item names already used on other decisions, for suggestions. */
export function knownWorkItems(decisions: Decision[]): string[] {
  const names = new Map<string, string>();
  for (const decision of decisions) {
    for (const item of decision.blockedWork) {
      const key = item.title.trim().toLowerCase();
      if (key && !names.has(key)) names.set(key, item.title.trim());
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function acceptSubmission(seen: Set<string>, submissionId: string): boolean {
  if (!submissionId || seen.has(submissionId)) return false;
  seen.add(submissionId);
  return true;
}
