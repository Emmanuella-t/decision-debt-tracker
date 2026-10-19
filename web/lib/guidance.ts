import { blockerGuide } from "./blockers";
import { compareISODate, diffISODays, formatDisplayDate } from "./dates";
import type { BlockerType, EvidenceStatus } from "./types";

/**
 * Rule-based suggestions. Each one is built from a fixed template and the
 * structured answers the person saved, and says which answers it used.
 * Long free-text answers are never pasted into a suggestion; when only free
 * text is available, the result asks for a short structured answer instead.
 * Nothing here creates, completes, or clears anything.
 */

type BlockerInput = {
  id: string;
  type: BlockerType;
  description: string;
  details: Record<string, string>;
  unknowns: string[];
  owner: string;
  resolvesWhen: string;
  status: "active" | "resolved";
  dependsOnDecisionId: string | null;
};

type ActionInput = { description: string; blockerId: string | null; suggestionKey: string | null; done: boolean; followUpDate: string | null };
type EvidenceInput = { id: string; title: string; status: EvidenceStatus; blockerId: string | null; summary: string };

export type GuidanceInput = {
  title: string;
  owner: string;
  dueDate: string | null;
  resolved: boolean;
  blockers: BlockerInput[];
  actions: ActionInput[];
  evidence: EvidenceInput[];
  dismissedSuggestions: string[];
};

export type Suggestion = {
  key: string;
  blockerId: string | null;
  text: string;
  why: string;
  basedOn: string[];
  /** An existing step with overlapping wording. Overlap is a hint only; the person decides whether it's the same. */
  similarTo?: string;
  /** The one question whose answer would make this blocker's guidance specific. "description" is the main question. */
  ask?: { key: string; label: string; placeholder: string };
};

export type GuidanceGap = { blockerId: string; message: string };

/** An active blocker whose main suggestion is withheld because a linked step is already open. */
export type CoveredBlocker = { blockerId: string; actionIndex: number };

export type Guidance = { suggestions: Suggestion[]; gaps: GuidanceGap[]; covered: CoveredBlocker[] };

type Upstream = { id: string; title: string; resolved: boolean };

type DraftLike = {
  title: string;
  owner: string;
  dueDate: string | null;
  stage: string;
  blockers: (Omit<BlockerInput, "dependsOnDecisionId"> & { dependsOnDecisionId: string | null })[];
  actions: (Omit<ActionInput, "blockerId" | "suggestionKey" | "followUpDate"> & {
    blockerId: string | null;
    suggestionKey: string | null;
    followUpDate: string | null;
  })[];
  evidence: (Omit<EvidenceInput, "blockerId"> & { blockerId: string | null })[];
  dismissedSuggestions: string[];
};

/** Accepts a saved decision or a form draft, where empty strings mean "not set". */
export function guidanceInput(source: DraftLike): GuidanceInput {
  const blank = (value: string | null) => (value ? value : null);
  return {
    title: source.title,
    owner: source.owner,
    dueDate: blank(source.dueDate),
    resolved: source.stage === "resolved",
    blockers: source.blockers.map((blocker) => ({ ...blocker, dependsOnDecisionId: blank(blocker.dependsOnDecisionId) })),
    actions: source.actions.map((action) => ({
      ...action,
      blockerId: blank(action.blockerId),
      suggestionKey: blank(action.suggestionKey),
      followUpDate: blank(action.followUpDate),
    })),
    evidence: source.evidence.map((item) => ({ ...item, blockerId: blank(item.blockerId) })),
    dismissedSuggestions: source.dismissedSuggestions,
  };
}

function trimEnd(text: string): string {
  return text.trim().replace(/[.!?;:,\s]+$/, "");
}

/** Short noun-like answers read naturally inside a sentence. Sentences, negations, and long text don't. */
function isShortPhrase(text: string, maxLength: number, maxWords: number): boolean {
  const value = trimEnd(text);
  if (!value || value.length > maxLength || value.split(/\s+/).length > maxWords) return false;
  if (/[.!?;]\s/.test(value) || /\n/.test(value)) return false;
  if (/n't\b|\bnot\b|\bno\b/i.test(value)) return false;
  return !/^(we|i|they|there|it|nobody|our|you|he|she|this|that|nothing|none|maybe|possibly|probably|unsure|unknown)\b/i.test(value);
}

/** Lowercases a sentence-case phrase so it reads mid-sentence. Phrases with other capitals (names, "Vendor A") are kept. */
function inline(text: string): string {
  const value = trimEnd(text);
  const rest = value.split(/\s+/).slice(1);
  if (/^[A-Z][a-z]/.test(value) && !/^[A-Z][a-z]+'s\b/.test(value) && !rest.some((word) => /^[A-Z]/.test(word))) {
    return value[0].toLowerCase() + value.slice(1);
  }
  return value;
}

/** A short thing (information, item, options) usable inside a suggestion, or null. */
function thing(text: string | undefined): string | null {
  return text && isShortPhrase(text, 90, 14) ? inline(text) : null;
}

/** A short name or group usable inside a suggestion, or null. */
function party(text: string | undefined): string | null {
  return text && isShortPhrase(text, 60, 8) ? trimEnd(text) : null;
}

function titleRef(title: string): string {
  const value = title.trim();
  return value && value.length <= 70 ? `“${value}”` : "this decision";
}

function clip(text: string, max = 60): string {
  const value = trimEnd(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function normalizeActionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "about", "then", "into", "before", "after", "what", "who", "whose"]);

function tokens(text: string): Set<string> {
  return new Set(normalizeActionText(text).split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

/** Share of distinct content words two texts have in common (0 to 1). */
export function wordOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const word of ta) if (tb.has(word)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * True only when two step descriptions are worded the same or almost the
 * same. Word overlap can't tell whether differently worded steps mean the
 * same thing, so looser overlap is reported as a hint, never as a match.
 */
export function similarAction(a: string, b: string): boolean {
  const x = normalizeActionText(a);
  const y = normalizeActionText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return wordOverlap(a, b) >= 0.8;
}

const HINT_OVERLAP = 0.5;

type Draft = { role: "primary" | "extra"; suffix: string; text: string; why: string; basedOn: string[]; ask?: Suggestion["ask"] };

function question(type: BlockerType, key: string): NonNullable<Suggestion["ask"]> {
  const guide = blockerGuide(type);
  if (key === "description") return { key, label: guide.primary.label, placeholder: guide.primary.placeholder };
  const follow = guide.followUps.find((item) => item.key === key);
  return { key, label: follow?.label ?? guide.primary.label, placeholder: follow?.placeholder ?? "" };
}

function forBlocker(blocker: BlockerInput, input: GuidanceInput, upstream: Upstream[], today: string): { drafts: Draft[]; gap: string | null } {
  const drafts: Draft[] = [];
  const d = blocker.details;
  const unknown = (key: string) => blocker.unknowns.includes(key);
  const ref = titleRef(input.title);
  const described = Boolean(blocker.description.trim());
  const primary = (suffix: string, text: string, why: string, basedOn: string[]) => drafts.push({ role: "primary", suffix, text, why, basedOn });
  const extra = (suffix: string, text: string, why: string, basedOn: string[]) => drafts.push({ role: "extra", suffix, text, why, basedOn });
  /** A category-level step that's safe without details, plus the one question that would make it specific. */
  const start = (key: string, text: string, why: string) =>
    drafts.push({ role: "primary", suffix: `ask-${key}`, text, why, basedOn: [`Blocker type: ${blockerGuide(blocker.type).label}`], ask: question(blocker.type, key) });
  let gap: string | null = null;

  switch (blocker.type) {
    case "missing_information": {
      if (!described && !d.items) {
        start("description", "Identify the most important missing information needed to make this decision.", "Once you know what's missing, you can decide where to get it.");
        break;
      }
      const info = thing(d.items) ?? thing(blocker.description);
      const source = party(d.sources);
      const need = thing(d.why_needed);
      const why = `${ref} is waiting on this information.${need ? ` You noted it's needed ${/^to\b/i.test(need) ? need : `for ${need}`}.` : ""}`;
      const infoBasis = thing(d.items) ? "Specific items needed" : "What's missing";
      if (info) {
        primary("request", source ? `Request ${info} from ${source}.` : `Request ${info}.`, why, [infoBasis, ...(source ? ["Where it might come from"] : [])]);
      } else if (source) {
        primary("request", `Ask ${source} for the missing information.`, why, ["Where it might come from"]);
        gap = "List the specific items needed, in a few words, to make this suggestion more precise.";
      } else {
        start("items", "Pick the specific items you still need.", "Short, specific items are easier to request.");
      }
      if (unknown("sources")) {
        extra("find-source", "Identify who holds or can produce this information.", "Nobody can be asked until the source is known.", ["Where it might come from (not known)"]);
      }
      if (unknown("why_needed")) {
        extra("clarify-need", "Write down how this information would change the decision.", "Knowing that shows how much information is enough.", ["Why it's needed (not known)"]);
      }
      break;
    }
    case "waiting_for_approval": {
      const item = thing(blocker.description);
      const approver = party(d.approver);
      const on = item ? ` on ${item}` : "";
      if (d.approver && approver) {
        let why = `${ref} can't move until they respond.`;
        const waited = d.requested_on ? diffISODays(d.requested_on, today) : null;
        if (waited !== null && waited > 0) why += ` You asked ${waited} ${waited === 1 ? "day" : "days"} ago (${formatDisplayDate(d.requested_on)}).`;
        primary("follow-up", `Follow up with ${approver}${on}.`, why, [...(item ? ["What you're waiting for"] : []), "Who you're waiting on", ...(d.requested_on ? ["When you asked"] : [])]);
      } else if (d.approver) {
        primary("follow-up", `Follow up with the person you noted${on}.`, `${ref} can't move until they respond.`, ["Who you're waiting on"]);
      } else if (described) {
        start("approver", `Confirm who you're waiting on${item ? ` for ${item}` : ""}.`, "Then you know exactly who to follow up with.");
      } else {
        start("approver", "Note who you're waiting on.", "Then you know exactly who to follow up with.");
      }
      break;
    }
    case "stakeholder_disagreement": {
      const people = party(d.participants);
      const disputed = thing(d.disputed_criteria);
      const help = thing(d.path_to_agreement);
      const why = `${ref} stays stuck until the people involved agree.${help ? ` You noted what could help: ${help}.` : ""}`;
      if (people && disputed) {
        primary("discuss", `Arrange a discussion with ${people} to settle ${disputed}.`, why, ["Who needs to take part", "Disputed criteria"]);
      } else if (people) {
        primary("discuss", `Arrange a discussion with ${people} to agree which criteria matter.`, why, ["Who needs to take part"]);
      } else if (disputed) {
        primary("who", `Name who needs to agree on ${disputed}.`, "A discussion can't be arranged until the participants are known.", ["Disputed criteria"]);
      } else {
        start("participants", "Name who needs to agree.", "Then you can bring the right people together.");
      }
      if (unknown("participants") && !disputed) {
        extra("who", "List who needs to take part in settling the disagreement.", "A discussion can't be arranged until the participants are known.", ["Who needs to take part (not known)"]);
      }
      break;
    }
    case "difficult_tradeoffs": {
      if (!described) {
        start("description", "List the options you're comparing.", "Naming the options is the first step to comparing them fairly.");
        break;
      }
      const options = thing(blocker.description) ?? "the options";
      const criteria = thing(d.criteria);
      if (criteria) {
        primary("compare", `Compare ${options} against ${criteria}.`, `Comparing on the same criteria makes the trade-off visible.`, ["Options", "Criteria that matter most"]);
      } else if (d.criteria) {
        primary("compare", `Compare ${options} against the criteria you noted.`, `Comparing on the same criteria makes the trade-off visible.`, ["Options", "Criteria that matter most"]);
      } else {
        primary("criteria", `Agree on the criteria that matter most before comparing ${options}.`, "Without shared criteria, the options can't be compared fairly.", ["Options"]);
      }
      if (d.uncertain) {
        const uncertain = thing(d.uncertain);
        extra(
          "uncertain",
          uncertain ? `Find out more about ${uncertain}.` : "Reduce the uncertainty you noted before comparing.",
          "Open uncertainty makes the comparison less reliable.",
          ["What's uncertain"],
        );
      }
      break;
    }
    case "dependency": {
      const linked = blocker.dependsOnDecisionId ? upstream.find((item) => item.id === blocker.dependsOnDecisionId) : undefined;
      const owner = party(d.upstream_owner);
      if (!linked && !described) {
        start("description", "Identify which decision has to be made first.", "Then you can check where it stands.");
      } else if (linked && linked.resolved) {
        primary("upstream-done", `Check whether this blocker can be cleared now that ${titleRef(linked.title)} is resolved.`, "The decision this one waits on is resolved.", ["Linked decision"]);
      } else {
        const target = linked ? titleRef(linked.title) : (thing(blocker.description) ?? "the decision this one waits on");
        primary(
          "upstream",
          `Check the status of ${target}${owner ? ` with ${owner}` : ""}.`,
          `This decision can't move until ${target} is settled.`,
          [linked ? "Linked decision" : "Which decision comes first", ...(owner ? ["Who owns it"] : [])],
        );
      }
      break;
    }
    case "ownership_unclear": {
      const clarifier = party(d.clarifier);
      primary(
        "owner",
        clarifier ? `Ask ${clarifier} who has authority to make this decision.` : "Agree who is authorized to make this decision.",
        "Nobody can make the call until one person is accountable for it.",
        clarifier ? ["Who could clarify"] : ["Who is involved"],
      );
      break;
    }
    case "other":
    case "unknown": {
      const help = thing(d.help);
      if (!described && !d.help) {
        if (blocker.type === "unknown") start("description", "Write down what feels unresolved about this decision.", "Naming it, even roughly, makes the next step clearer.");
        else start("description", "Name what's holding this decision up.", "Naming it makes the next step clearer.");
      } else if (help) {
        primary("help", `Take the step you noted would help: ${help}.`, `You recorded this as what would move ${ref} forward.`, ["What would help"]);
      } else if (d.help) {
        gap = "Shorten what would help into one brief step to get a suggestion.";
      } else {
        start("help", "Decide what would help move it forward.", "One small step is easier to start than a whole problem.");
      }
      break;
    }
  }
  return { drafts, gap };
}

export function suggestActions(input: GuidanceInput, options: { today: string; decisions?: Upstream[] }): Guidance {
  if (input.resolved) return { suggestions: [], gaps: [], covered: [] };
  const upstream = options.decisions ?? [];
  const all: Suggestion[] = [];
  const gaps: GuidanceGap[] = [];
  const covered: CoveredBlocker[] = [];
  const active = input.blockers.filter((blocker) => blocker.status === "active");

  for (const blocker of active) {
    const result = forBlocker(blocker, input, upstream, options.today);
    if (result.gap) gaps.push({ blockerId: blocker.id, message: result.gap });
    // A step the person linked to this blocker is already the main way through it.
    const openLinked = input.actions.findIndex((action) => !action.done && action.blockerId === blocker.id);
    if (openLinked >= 0 && result.drafts.some((draft) => draft.role === "primary")) covered.push({ blockerId: blocker.id, actionIndex: openLinked });
    for (const draft of result.drafts) {
      if (draft.role === "primary" && openLinked >= 0) continue;
      all.push({ key: `${blocker.id}:${draft.suffix}`, blockerId: blocker.id, text: draft.text, why: draft.why, basedOn: draft.basedOn, ...(draft.ask ? { ask: draft.ask } : {}) });
    }

    const unreviewed = input.evidence.filter((item) => item.blockerId === blocker.id && item.status === "unverified" && item.summary.trim()).length;
    if (unreviewed > 0) {
      all.push({
        key: `${blocker.id}:review-evidence`,
        blockerId: blocker.id,
        text: unreviewed === 1 ? "Review the finding recorded for this blocker." : `Review the ${unreviewed} findings recorded for this blocker.`,
        why: "A finding counts toward readiness only after you mark it reviewed.",
        basedOn: ["Evidence log"],
      });
    }
  }

  for (const item of input.evidence) {
    const blocker = active.find((candidate) => candidate.id === item.blockerId);
    if (item.status !== "challenged" || (item.blockerId && !blocker)) continue;
    all.push({
      key: `${item.id}:challenged`,
      blockerId: blocker?.id ?? null,
      text: `Look into why “${clip(item.title || item.summary)}” was challenged.`,
      why: "Challenged evidence may conflict with other findings.",
      basedOn: ["Evidence log"],
    });
  }

  if (active.length === 0 && !input.actions.some((action) => !action.done)) {
    const owner = party(input.owner);
    const due = input.dueDate ? ` before the target date (${formatDisplayDate(input.dueDate)})` : "";
    all.push({
      key: "decision:schedule",
      blockerId: null,
      text: `Set a time to make the decision${owner ? ` with ${owner}` : ""}${due}.`,
      why: "Nothing is recorded as blocking it, and no next step is open.",
      basedOn: ["Blockers", "Next steps", ...(owner ? ["Decision owner"] : []), ...(input.dueDate ? ["Target date"] : [])],
    });
  }

  const dismissed = new Set(input.dismissedSuggestions);
  const suggestions: Suggestion[] = [];
  for (const suggestion of all) {
    if (dismissed.has(suggestion.key)) continue;
    if (input.actions.some((action) => action.suggestionKey === suggestion.key || similarAction(action.description, suggestion.text))) continue;
    const near = input.actions
      .filter((action) => !action.done && (!suggestion.blockerId || !action.blockerId || action.blockerId === suggestion.blockerId))
      .map((action) => ({ action, overlap: wordOverlap(action.description, suggestion.text) }))
      .filter((entry) => entry.overlap >= HINT_OVERLAP)
      .sort((a, b) => b.overlap - a.overlap)[0];
    suggestions.push(near ? { ...suggestion, similarTo: near.action.description } : suggestion);
  }
  return { suggestions, gaps, covered };
}

export type NextBestStep =
  | { kind: "action"; index: number; text: string; why: string; followUpDate: string | null; overdue: boolean }
  | { kind: "suggestion"; suggestion: Suggestion }
  | { kind: "none"; message: string };

/** Picks one step to show first: an open step on an active blocker, then a suggestion, then any open step. */
export function nextBestStep(input: GuidanceInput, guidance: Guidance, today?: string): NextBestStep {
  if (input.resolved) return { kind: "none", message: "This decision is resolved." };
  const active = new Set(input.blockers.filter((blocker) => blocker.status === "active").map((blocker) => blocker.id));
  const open = input.actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => !action.done)
    .sort((a, b) => (a.action.followUpDate ?? "9999").localeCompare(b.action.followUpDate ?? "9999"));
  const status = (followUpDate: string | null) => ({
    followUpDate,
    overdue: Boolean(today && followUpDate && compareISODate(followUpDate, today) === -1),
  });
  const onBlocker = open.find(({ action }) => action.blockerId && active.has(action.blockerId));
  if (onBlocker) {
    const blocker = input.blockers.find((item) => item.id === onBlocker.action.blockerId);
    return {
      kind: "action",
      index: onBlocker.index,
      text: onBlocker.action.description,
      why: `It's your open step on an active blocker${blocker ? `: ${blockerGuide(blocker.type).label}` : ""}.`,
      ...status(onBlocker.action.followUpDate),
    };
  }
  if (guidance.suggestions.length > 0) return { kind: "suggestion", suggestion: guidance.suggestions[0] };
  if (open.length > 0) {
    return { kind: "action", index: open[0].index, text: open[0].action.description, why: "It's the earliest open step.", ...status(open[0].action.followUpDate) };
  }
  if (guidance.gaps.length > 0) return { kind: "none", message: guidance.gaps[0].message };
  return { kind: "none", message: "There isn't enough recorded yet to suggest a step." };
}
