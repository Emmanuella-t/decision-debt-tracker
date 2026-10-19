import { emptyDraft, newBlockerDraft } from "./data/decisions";
import type { Blocker, BlockerDraft, Decision, DecisionDraft, Evidence, NextAction } from "./types";

export const today = "2026-10-15";
export const todayDate = new Date(2026, 9, 15, 12, 0, 0, 0);

export function draft(overrides: Partial<DecisionDraft> = {}): DecisionDraft {
  return { ...emptyDraft(today), title: "Choose a vendor", category: "budget", ...overrides };
}

export function blocker(overrides: Partial<BlockerDraft> = {}): BlockerDraft {
  return { ...newBlockerDraft("missing_information", "2026-10-01"), description: "No security review yet", ...overrides };
}

export function stored(overrides: Partial<Decision> = {}): Decision {
  return {
    schemaVersion: 3,
    id: "d1",
    title: "Choose a vendor",
    description: "",
    category: "budget",
    department: "Product",
    owner: "",
    impact: 5,
    stress: 5,
    urgency: null,
    reversibility: null,
    exposure: null,
    createdDate: "2026-09-15",
    dueDate: "2026-10-01",
    stage: "new",
    resolvedDate: null,
    resolutionNote: null,
    blockers: [],
    blockedWork: [],
    actions: [],
    evidence: [],
    dismissedSuggestions: [],
    readinessOverride: null,
    events: [],
    ...overrides,
  };
}

export function savedBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    id: "b1",
    type: "missing_information",
    description: "Demand forecasts for both launch dates",
    details: {},
    unknowns: [],
    owner: "",
    followUpDate: null,
    dependsOnDecisionId: null,
    identifiedDate: "2026-09-20",
    resolvesWhen: "",
    status: "active",
    resolvedDate: null,
    resolutionNote: null,
    clearedHow: null,
    ...overrides,
  };
}

export function savedAction(overrides: Partial<NextAction> = {}): NextAction {
  return {
    id: "a1",
    description: "Ask Finance",
    owner: "",
    followUpDate: null,
    done: false,
    completedDate: null,
    createdDate: "2026-09-15",
    blockerId: null,
    suggestionKey: null,
    ...overrides,
  };
}

export function savedEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    blockerId: "b1",
    title: "Finance forecast",
    question: "What demand do we expect?",
    sourceType: "data",
    sourceName: "Finance team",
    url: "https://example.com/forecast",
    collectedDate: "2026-10-01",
    summary: "November demand is 20% lower",
    limitations: "Based on last year only",
    status: "unverified",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

export function memoryStorage(initial: Record<string, string> = {}) {
  const memory = new Map(Object.entries(initial));
  return {
    memory,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
}
