import type { BlockerType, DecisionStage, EvidenceSourceType, EvidenceStatus, Reversibility, Urgency } from "./types";

export type DiagnosisQuestion = {
  key: string;
  label: string;
  placeholder: string;
  kind?: "text" | "date";
};

export type BlockerGuide = {
  type: BlockerType;
  label: string;
  explanation: string;
  /** Saved as the blocker description. */
  primary: { label: string; placeholder: string };
  /** Shown after the first answer, one small group at a time. */
  followUps: DiagnosisQuestion[];
  /** Saved as the clearing criteria. */
  criteria: { label: string; placeholder: string };
};

/** Placeholders are examples of how to answer. They are never saved as answers. */
export const BLOCKER_GUIDES: BlockerGuide[] = [
  {
    type: "missing_information",
    label: "Missing information",
    explanation: "Something you need to know before deciding isn't available yet.",
    primary: {
      label: "What information is missing?",
      placeholder: "e.g., Comparable demand forecasts and launch cost estimates for November and January",
    },
    followUps: [
      { key: "items", label: "Which specific items are needed, in a few words?", placeholder: "e.g., Comparable demand forecasts and launch cost estimates for both launch options" },
      { key: "why_needed", label: "Why is it needed?", placeholder: "e.g., To see which launch date is commercially feasible" },
      { key: "sources", label: "Where might it come from?", placeholder: "e.g., Finance and Marketing teams" },
    ],
    criteria: {
      label: "What would confirm the gap is closed?",
      placeholder: "e.g., Both sets of estimates are reviewed and good enough to compare the options",
    },
  },
  {
    type: "waiting_for_approval",
    label: "Waiting on someone",
    explanation: "Someone has to respond, provide input, or sign off first.",
    primary: { label: "What are you waiting for?", placeholder: "e.g., Sign-off on the revised Q4 budget" },
    followUps: [
      { key: "approver", label: "Who are you waiting on?", placeholder: "e.g., Finance lead" },
      { key: "requested_on", label: "When did you ask?", placeholder: "", kind: "date" },
    ],
    criteria: { label: "What would count as a response?", placeholder: "e.g., Written sign-off from the finance lead" },
  },
  {
    type: "stakeholder_disagreement",
    label: "Stakeholder disagreement",
    explanation: "The people involved don't agree on the best option.",
    primary: { label: "What are the competing positions?", placeholder: "e.g., Sales wants November, Product wants January" },
    followUps: [
      { key: "disputed_criteria", label: "Which criteria are disputed?", placeholder: "e.g., Revenue timing versus product quality" },
      { key: "participants", label: "Who needs to take part?", placeholder: "e.g., Sales and Product leads" },
      { key: "path_to_agreement", label: "What would help reach agreement?", placeholder: "e.g., Agreeing how to weigh revenue against risk" },
    ],
    criteria: { label: "What would show this is settled?", placeholder: "e.g., Both leads agree on one date in writing" },
  },
  {
    type: "difficult_tradeoffs",
    label: "Difficult trade-offs",
    explanation: "Each option has real costs, and it's hard to compare them.",
    primary: { label: "What options are being compared?", placeholder: "e.g., Vendor A and Vendor B" },
    followUps: [
      { key: "criteria", label: "Which criteria matter most?", placeholder: "e.g., Total cost and integration effort" },
      { key: "uncertain", label: "What is still uncertain?", placeholder: "e.g., Vendor B's support quality" },
      { key: "reversible", label: "Could the choice be reversed later?", placeholder: "e.g., Yes, but switching costs about three months" },
    ],
    criteria: { label: "What would make the choice clear enough?", placeholder: "e.g., Both options scored on the same criteria" },
  },
  {
    type: "dependency",
    label: "Another decision is blocking it",
    explanation: "Something else has to be decided or finished first.",
    primary: { label: "Which decision has to be resolved first?", placeholder: "e.g., The packaging decision" },
    followUps: [
      { key: "upstream_owner", label: "Who owns that decision?", placeholder: "e.g., Packaging team lead" },
      { key: "prerequisite", label: "What must happen before this one can move?", placeholder: "e.g., Final box size is agreed" },
    ],
    criteria: { label: "What would show it is no longer in the way?", placeholder: "e.g., The packaging decision is resolved" },
  },
  {
    type: "ownership_unclear",
    label: "Ownership is unclear",
    explanation: "It isn't clear who has the authority to make this call.",
    primary: { label: "Who is involved right now?", placeholder: "e.g., Marketing and Product" },
    followUps: [
      { key: "authority", label: "Who should have authority to decide?", placeholder: "e.g., Possibly the VP of Product" },
      { key: "clarifier", label: "Who could clarify accountability?", placeholder: "e.g., Chief Operating Officer" },
    ],
    criteria: { label: "What would show ownership is clear?", placeholder: "e.g., One named person agrees to make the call" },
  },
  {
    type: "unknown",
    label: "Not sure yet",
    explanation: "Something is in the way, but it isn't clear what yet.",
    primary: { label: "What feels unresolved?", placeholder: "e.g., Neither date feels right, and I can't say why" },
    followUps: [{ key: "help", label: "What would help move it forward?", placeholder: "e.g., Talking it through with the team" }],
    criteria: { label: "What would tell you it's no longer in the way?", placeholder: "Describe what done looks like" },
  },
  {
    type: "other",
    label: "Something else",
    explanation: "None of these fit. Describe it in your own words.",
    primary: { label: "What's holding this up?", placeholder: "Describe what's in the way" },
    followUps: [{ key: "help", label: "What would help move it forward?", placeholder: "e.g., A short meeting with the legal team" }],
    criteria: { label: "What would tell you it's no longer in the way?", placeholder: "Describe what done looks like" },
  },
];

export const BLOCKER_TYPES = BLOCKER_GUIDES.map((guide) => guide.type);

export function blockerGuide(type: BlockerType): BlockerGuide {
  return BLOCKER_GUIDES.find((guide) => guide.type === type) ?? BLOCKER_GUIDES.find((guide) => guide.type === "other")!;
}

/** Quick Start answers to "What's holding you up?". Null means nothing is in the way. */
export const QUICK_START_CHOICES: { value: string; label: string; type: BlockerType | null }[] = [
  { value: "information", label: "I need more information.", type: "missing_information" },
  { value: "waiting", label: "I'm waiting on someone.", type: "waiting_for_approval" },
  { value: "options", label: "I'm comparing options.", type: "difficult_tradeoffs" },
  { value: "alignment", label: "We're not aligned yet.", type: "stakeholder_disagreement" },
  { value: "dependency", label: "Another decision is blocking this.", type: "dependency" },
  { value: "unsure", label: "I'm not sure yet.", type: "unknown" },
  { value: "nothing", label: "Nothing — I'm still thinking it through.", type: null },
];

export function followUpQuestion(type: BlockerType, key: string): DiagnosisQuestion | undefined {
  return blockerGuide(type).followUps.find((question) => question.key === key);
}

export const STAGE_LABELS: Record<DecisionStage, string> = {
  new: "New",
  under_review: "Under review",
  ready_to_decide: "Ready to decide",
  resolved: "Resolved",
};

export const OPEN_STAGES: { value: Exclude<DecisionStage, "resolved">; label: string; hint: string }[] = [
  { value: "new", label: "New", hint: "Just recorded. Nobody has started working through it yet." },
  { value: "under_review", label: "Under review", hint: "People are actively working through it." },
  { value: "ready_to_decide", label: "Ready to decide", hint: "Nothing is in the way. It only needs to be made." },
];

export const URGENCY_LABELS: Record<Urgency, string> = {
  low: "Low: can wait",
  normal: "Normal",
  high: "High: needed soon",
};

export const REVERSIBILITY_LABELS: Record<Reversibility, string> = {
  easy: "Easy to change later",
  costly: "Costly to change later",
  irreversible: "Hard or impossible to undo",
};

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSourceType, string> = {
  document: "Document or report",
  data: "Data or analysis",
  conversation: "Conversation or interview",
  meeting: "Meeting",
  website: "Website",
  other: "Other",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  unverified: "Not reviewed yet",
  reviewed: "Reviewed",
  challenged: "Challenged",
};

const DECISION_WORDS =
  /\b(should|which|whether|choose|select|pick|decide|approve|hire|launch|delay|adopt|keep|drop|switch|accept|reject|vs\.?|versus|or)\b/i;

/**
 * Advisory only. Flags short labels like "Budget" that read like a topic,
 * not a choice. Never blocks saving.
 */
export function vagueTitleHint(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (trimmed.includes("?")) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 3 || DECISION_WORDS.test(trimmed)) return null;
  return `"${trimmed}" sounds like a topic. Try phrasing it as the choice to be made, for example "Should we increase the ${trimmed.toLowerCase()} for Q4?"`;
}
