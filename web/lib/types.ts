export const SCHEMA_VERSION = 3;

/**
 * Lifecycle stage. "Blocked" is not a stage: a decision is blocked when it has
 * at least one active blocker, so it can be under review and blocked at once.
 */
export type DecisionStage = "new" | "under_review" | "ready_to_decide" | "resolved";
export type OpenStage = Exclude<DecisionStage, "resolved">;

/** Kept for compatibility with the earlier open/resolved form. */
export type DecisionStatus = "open" | "resolved";

export type BlockerType =
  | "missing_information"
  | "waiting_for_approval"
  | "stakeholder_disagreement"
  | "difficult_tradeoffs"
  | "dependency"
  | "ownership_unclear"
  | "other"
  /** Something is in the way, but the person isn't sure what yet. */
  | "unknown";

export type BlockerStatus = "active" | "resolved";

/** How a blocker was cleared. Null for blockers cleared before this was recorded. */
export type ClearedHow = "criteria_met" | "not_applicable" | "override";

export type Blocker = {
  id: string;
  type: BlockerType;
  /** Answer to the first diagnosis question for the type. */
  description: string;
  /** Answers to the type's follow-up questions, keyed by question key. */
  details: Record<string, string>;
  /** Follow-up questions the person marked as not known yet. */
  unknowns: string[];
  owner: string;
  followUpDate: string | null;
  /** Another decision in this browser that has to be resolved first. */
  dependsOnDecisionId: string | null;
  identifiedDate: string;
  /** Clearing criteria. */
  resolvesWhen: string;
  status: BlockerStatus;
  resolvedDate: string | null;
  resolutionNote: string | null;
  clearedHow: ClearedHow | null;
};

export type WorkItem = {
  id: string;
  title: string;
};

export type NextAction = {
  id: string;
  description: string;
  owner: string;
  followUpDate: string | null;
  done: boolean;
  completedDate: string | null;
  createdDate: string;
  blockerId: string | null;
  /** Set when the step came from a suggestion, so it isn't suggested again. */
  suggestionKey: string | null;
};

export type EvidenceSourceType = "document" | "data" | "conversation" | "meeting" | "website" | "other";
export type EvidenceStatus = "unverified" | "reviewed" | "challenged";

export type Evidence = {
  id: string;
  blockerId: string | null;
  title: string;
  question: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  url: string | null;
  collectedDate: string | null;
  summary: string;
  limitations: string;
  status: EvidenceStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReadinessOverride = { reason: string; at: string };

export type Urgency = "low" | "normal" | "high";
export type Reversibility = "easy" | "costly" | "irreversible";

export type LifecycleEventType =
  | "created"
  | "updated"
  | "stage_changed"
  | "blocker_added"
  | "blocker_updated"
  | "blocker_removed"
  | "blocker_resolved"
  | "action_added"
  | "action_linked"
  | "action_completed"
  | "evidence_added"
  | "evidence_updated"
  | "evidence_status_changed"
  | "readiness_noted"
  | "resolved"
  | "reopened";

export type LifecycleEvent = {
  type: LifecycleEventType;
  at: string;
  note?: string;
  /** Context kept with the event, such as the outcome that was in place before reopening. */
  detail?: string;
};

export type Decision = {
  schemaVersion: number;
  id: string;
  title: string;
  description: string;
  category: string;
  department: string | null;
  owner: string;
  /** Null means not rated yet. An unrated decision has no debt score rather than a made-up one. */
  impact: number | null;
  stress: number | null;
  urgency: Urgency | null;
  reversibility: Reversibility | null;
  exposure: number | null;
  createdDate: string;
  /** Target decision date. Field name kept so the debt score is unchanged. */
  dueDate: string | null;
  stage: DecisionStage;
  resolvedDate: string | null;
  resolutionNote: string | null;
  blockers: Blocker[];
  blockedWork: WorkItem[];
  actions: NextAction[];
  evidence: Evidence[];
  dismissedSuggestions: string[];
  readinessOverride: ReadinessOverride | null;
  events: LifecycleEvent[];
};

export type BlockerDraft = Omit<
  Blocker,
  "resolvedDate" | "resolutionNote" | "followUpDate" | "dependsOnDecisionId" | "clearedHow"
> & {
  resolvedDate: string;
  resolutionNote: string;
  followUpDate: string;
  dependsOnDecisionId: string;
  clearedHow: ClearedHow | "";
};

export type ActionDraft = Omit<NextAction, "followUpDate" | "blockerId" | "completedDate" | "suggestionKey"> & {
  followUpDate: string;
  completedDate: string;
  blockerId: string;
  suggestionKey: string;
};

export type EvidenceDraft = Omit<Evidence, "blockerId" | "url" | "collectedDate" | "createdAt" | "updatedAt"> & {
  blockerId: string;
  url: string;
  collectedDate: string;
  createdAt: string;
  updatedAt: string;
};

export type DecisionDraft = {
  title: string;
  description: string;
  category: string;
  department: string;
  owner: string;
  impact: number | null;
  stress: number | null;
  urgency: Urgency | "";
  reversibility: Reversibility | "";
  exposure: string;
  createdDate: string;
  dueDate: string;
  stage: DecisionStage;
  resolvedDate: string;
  resolutionNote: string;
  blockers: BlockerDraft[];
  blockedWork: WorkItem[];
  actions: ActionDraft[];
  evidence: EvidenceDraft[];
  dismissedSuggestions: string[];
  /** Reason for treating the decision as ready despite open items. Empty means none. */
  readinessOverride: string;
};

export type Snapshot = {
  date: string;
  totalDebt: number;
  openCount: number;
  overdueCount: number;
};
