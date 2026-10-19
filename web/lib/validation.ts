import { BLOCKER_TYPES, blockerGuide } from "./blockers";
import {
  ACTION_MAX,
  BLOCKER_TEXT_MAX,
  CATEGORY_MAX,
  DEPARTMENTS,
  DESCRIPTION_MAX,
  EVIDENCE_TEXT_MAX,
  EVIDENCE_TITLE_MAX,
  EXPOSURE_MAX,
  LONG_OPEN_DAYS,
  MAX_ACTIONS,
  MAX_BLOCKERS,
  MAX_DISMISSED,
  MAX_EVIDENCE,
  SOURCE_NAME_MAX,
  URL_MAX,
  MAX_WORK_ITEMS,
  OWNER_MAX,
  RATING_MAX,
  RATING_MIN,
  REOPEN_REASON_MAX,
  RESOLUTION_NOTE_MAX,
  TITLE_MAX,
  WORK_ITEM_MAX,
  type Department,
} from "./constants";
import { compareISODate, diffISODays, isRealDate } from "./dates";
import type {
  BlockerType,
  Decision,
  DecisionDraft,
  DecisionStage,
  EvidenceSourceType,
  EvidenceStatus,
  Reversibility,
  Urgency,
} from "./types";

/** Keys are field names, or list paths such as "blockers.0.description". */
export type ErrorMap = Record<string, string>;

export type ValidationResult = {
  errors: ErrorMap;
  warnings: string[];
};

export class DecisionValidationError extends Error {
  errors: ErrorMap;

  constructor(errors: ErrorMap) {
    super(Object.values(errors)[0] ?? "Check the highlighted fields.");
    this.name = "DecisionValidationError";
    this.errors = errors;
  }
}

export const STAGES: DecisionStage[] = ["new", "under_review", "ready_to_decide", "resolved"];
export const URGENCIES: Urgency[] = ["low", "normal", "high"];
export const REVERSIBILITIES: Reversibility[] = ["easy", "costly", "irreversible"];

export function hasErrors(result: { errors: ErrorMap }): boolean {
  return Object.keys(result.errors).length > 0;
}

export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function hasWordCharacter(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/** Shortest explanation accepted when a blocker is cleared without plainly meeting its criteria. */
export const CLEARING_EXPLANATION_MIN = 10;

export function isClearingExplanation(value: string | null | undefined): boolean {
  const text = cleanText(value ?? "");
  return text.length >= CLEARING_EXPLANATION_MIN && hasWordCharacter(text);
}

function ratingError(value: number, label: string): string | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return `Enter a whole number from ${RATING_MIN} to ${RATING_MAX} for ${label}.`;
  }
  if (!Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) {
    return `${label[0].toUpperCase()}${label.slice(1)} must be a whole number from ${RATING_MIN} to ${RATING_MAX}.`;
  }
  return null;
}

export function dateError(value: string, label: string): string | null {
  if (!value.trim()) return `Enter the ${label}.`;
  if (!isRealDate(value)) {
    return `Enter a real calendar date for the ${label}. February 29 is only valid in a leap year.`;
  }
  return null;
}

/** Empty string means "not set". Otherwise a non-negative amount with at most two decimals. */
export function parseExposure(value: string): { value: number | null; error: string | null } {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      value: null,
      error: "Enter the exposure as a positive amount with up to two decimal places, such as 25000 or 1250.50.",
    };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount > EXPOSURE_MAX) {
    return { value: null, error: "That amount is too large to be a realistic estimate. Check for extra digits." };
  }
  return { value: amount, error: null };
}

function textLimit(errors: ErrorMap, key: string, value: string, max: number, label: string) {
  if (value.length > max) errors[key] = `Keep the ${label} to ${max} characters or fewer.`;
}

export function activeBlockerCount(draft: Pick<DecisionDraft, "blockers">): number {
  return draft.blockers.filter((blocker) => blocker.status === "active").length;
}

export function validateDecision(
  draft: DecisionDraft,
  options: {
    today: string;
    decisions: Decision[];
    ignoreId?: string;
  },
): ValidationResult {
  const errors: ErrorMap = {};
  const warnings: string[] = [];

  const title = cleanText(draft.title);
  if (!title) errors.title = "Write the decision that needs to be made.";
  else if (!hasWordCharacter(title)) errors.title = "Use words to describe the decision, not only symbols.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the decision to ${TITLE_MAX} characters or fewer.`;

  textLimit(errors, "description", cleanText(draft.description), DESCRIPTION_MAX, "context");
  textLimit(errors, "category", cleanText(draft.category), CATEGORY_MAX, "category");
  textLimit(errors, "owner", cleanText(draft.owner), OWNER_MAX, "owner name");

  if (draft.department && !DEPARTMENTS.includes(draft.department as Department)) {
    errors.department = "Choose a department from the list, or leave it unset.";
  }

  const createdError = dateError(draft.createdDate, "created date");
  if (createdError) errors.createdDate = createdError;
  else if (compareISODate(draft.createdDate, options.today) === 1) {
    errors.createdDate = "The created date cannot be in the future.";
  }

  if (draft.dueDate.trim()) {
    const dueError = dateError(draft.dueDate, "target decision date");
    if (dueError) errors.dueDate = dueError;
    else if (!errors.createdDate && compareISODate(draft.dueDate, draft.createdDate) === -1) {
      errors.dueDate = "The target date cannot be earlier than the date this decision was created.";
    }
  }

  if (!STAGES.includes(draft.stage)) {
    errors.stage = "Choose where this decision stands.";
  }

  // Ratings are optional. Unset means "not rated", never a default score.
  const impactError = draft.impact === null ? null : ratingError(draft.impact, "impact");
  if (impactError) errors.impact = impactError;
  const stressError = draft.stress === null ? null : ratingError(draft.stress, "stress");
  if (stressError) errors.stress = stressError;
  if (draft.urgency && !URGENCIES.includes(draft.urgency)) errors.urgency = "Choose an urgency from the list.";
  if (draft.reversibility && !REVERSIBILITIES.includes(draft.reversibility)) {
    errors.reversibility = "Choose how reversible this decision is.";
  }
  const exposure = parseExposure(draft.exposure);
  if (exposure.error) errors.exposure = exposure.error;

  validateBlockers(draft, options, errors);
  validateWork(draft, errors);
  validateActions(draft, options.today, errors);
  validateEvidence(draft, options.today, errors);

  if (!Array.isArray(draft.dismissedSuggestions) || draft.dismissedSuggestions.length > MAX_DISMISSED) {
    errors.dismissedSuggestions = "Too many dismissed suggestions are stored for this decision.";
  } else if (draft.dismissedSuggestions.some((key) => typeof key !== "string" || key.length > 200)) {
    errors.dismissedSuggestions = "A dismissed suggestion could not be read.";
  }
  const override = cleanText(draft.readinessOverride);
  if (override) {
    if (draft.stage === "resolved") errors.readinessOverride = "A resolved decision doesn't need a readiness note.";
    else if (!hasWordCharacter(override) || override.length < 5) errors.readinessOverride = "Explain in a few words why it's ready anyway.";
    else textLimit(errors, "readinessOverride", override, REOPEN_REASON_MAX, "note");
  }

  const activeBlockers = activeBlockerCount(draft);
  if (draft.stage === "ready_to_decide" && activeBlockers > 0) {
    errors.stage = "A decision can't be ready to decide while something is still blocking it. Choose another stage, or remove the blocker.";
  }

  if (draft.stage === "resolved") {
    const resolvedError = dateError(draft.resolvedDate, "resolution date");
    if (resolvedError) errors.resolvedDate = resolvedError;
    else if (compareISODate(draft.resolvedDate, options.today) === 1) {
      errors.resolvedDate = "The resolution date cannot be in the future.";
    } else if (!errors.createdDate && compareISODate(draft.resolvedDate, draft.createdDate) === -1) {
      errors.resolvedDate = "The resolution date cannot be earlier than the date this decision was created.";
    }
    const note = cleanText(draft.resolutionNote);
    if (!note) errors.resolutionNote = "Describe what was decided so the resolution is documented.";
    else textLimit(errors, "resolutionNote", note, RESOLUTION_NOTE_MAX, "outcome");
    if (activeBlockers > 0) {
      errors.stage = "Close or remove the active blockers before marking this decision resolved.";
    }
  } else if (draft.resolvedDate.trim()) {
    errors.resolvedDate = "An open decision cannot have a resolution date.";
  }

  if (!errors.dueDate && draft.stage !== "resolved" && draft.dueDate && compareISODate(draft.dueDate, options.today) === -1) {
    warnings.push("The target date has already passed. The decision will count as overdue.");
  }
  if (!errors.createdDate && draft.stage !== "resolved") {
    const age = diffISODays(draft.createdDate, options.today);
    if (age !== null && age >= LONG_OPEN_DAYS) warnings.push(`This decision has been open for ${age} days.`);
  }
  if (draft.stage !== "resolved" && !draft.actions.some((action) => !action.done)) {
    warnings.push("There is no open next step. Decisions tend to stall without one.");
  }
  if (title) {
    const duplicate = options.decisions.some(
      (decision) =>
        decision.id !== options.ignoreId &&
        !decision.resolvedDate &&
        decision.title.trim().toLowerCase() === title.toLowerCase(),
    );
    if (duplicate) warnings.push("Another open decision already asks this question.");
  }

  return { errors, warnings };
}

function validateBlockers(
  draft: DecisionDraft,
  options: { today: string; decisions: Decision[]; ignoreId?: string },
  errors: ErrorMap,
) {
  const today = options.today;
  if (draft.blockers.length > MAX_BLOCKERS) {
    errors.blockers = `Record up to ${MAX_BLOCKERS} blockers. Combine related ones.`;
  }
  const ids = new Set<string>();
  draft.blockers.forEach((blocker, index) => {
    const key = `blockers.${index}`;
    if (!blocker.id || ids.has(blocker.id)) errors[`${key}.description`] = "This blocker has a duplicate identifier. Remove it and add it again.";
    ids.add(blocker.id);
    const knownType = BLOCKER_TYPES.includes(blocker.type as BlockerType);
    if (!knownType) errors[`${key}.type`] = "Choose what kind of blocker this is.";
    if (blocker.status !== "active" && blocker.status !== "resolved") {
      errors[`${key}.status`] = "A blocker is either active or resolved.";
    }
    // A blocker can be saved with only its category. The workspace asks for the details later.
    const description = cleanText(blocker.description);
    if (description && (!hasWordCharacter(description) || (blocker.status === "active" && description.length < 3))) {
      errors[`${key}.description`] = "Describe the blocker in a few words.";
    } else {
      textLimit(errors, `${key}.description`, description, BLOCKER_TEXT_MAX, "blocker description");
    }
    textLimit(errors, `${key}.owner`, cleanText(blocker.owner), OWNER_MAX, "name");
    textLimit(errors, `${key}.resolvesWhen`, cleanText(blocker.resolvesWhen), BLOCKER_TEXT_MAX, "description");

    if (knownType) {
      const questions = blockerGuide(blocker.type).followUps;
      const allowed = new Set(questions.map((question) => question.key));
      const details = blocker.details && typeof blocker.details === "object" ? blocker.details : {};
      for (const [field, answer] of Object.entries(details)) {
        const question = questions.find((item) => item.key === field);
        if (!allowed.has(field) || typeof answer !== "string") {
          errors[`${key}.details`] = "One of the answers doesn't belong to this kind of blocker.";
          continue;
        }
        const cleaned = cleanText(answer);
        if (!cleaned) continue;
        if (question?.kind === "date") {
          const err = dateError(cleaned, "date");
          if (err) errors[`${key}.details.${field}`] = err;
          else if (compareISODate(cleaned, today) === 1) errors[`${key}.details.${field}`] = "This date can't be in the future.";
        } else {
          textLimit(errors, `${key}.details.${field}`, cleaned, BLOCKER_TEXT_MAX, "answer");
        }
      }
      if (!Array.isArray(blocker.unknowns) || blocker.unknowns.some((field) => !allowed.has(field))) {
        errors[`${key}.details`] = "One of the questions marked as not known doesn't belong to this kind of blocker.";
      }
    }

    if (blocker.followUpDate.trim()) {
      const followError = dateError(blocker.followUpDate, "follow-up date");
      if (followError) errors[`${key}.followUpDate`] = followError;
      else if (isRealDate(draft.createdDate) && compareISODate(blocker.followUpDate, draft.createdDate) === -1) {
        errors[`${key}.followUpDate`] = "The follow-up date can't be before the decision was created.";
      }
    }

    if (blocker.dependsOnDecisionId) {
      const upstream = options.decisions.find((decision) => decision.id === blocker.dependsOnDecisionId);
      if (blocker.type !== "dependency") errors[`${key}.dependsOnDecisionId`] = "Only an 'another decision' blocker can link to a decision.";
      else if (!upstream) errors[`${key}.dependsOnDecisionId`] = "The linked decision no longer exists. Choose another or remove the link.";
      else if (upstream.id === options.ignoreId) errors[`${key}.dependsOnDecisionId`] = "A decision can't wait on itself.";
    }

    if (blocker.clearedHow && !["criteria_met", "not_applicable", "override"].includes(blocker.clearedHow)) {
      errors[`${key}.clearedHow`] = "Choose how this blocker was cleared.";
    }
    if (blocker.status === "resolved") {
      const note = cleanText(blocker.resolutionNote);
      textLimit(errors, `${key}.resolutionNote`, note, RESOLUTION_NOTE_MAX, "reason");
      if (blocker.clearedHow === "criteria_met" && !cleanText(blocker.resolvesWhen)) {
        errors[`${key}.clearedHow`] = "There are no clearing criteria to meet. Add them, or explain why they don't apply.";
      }
      if ((blocker.clearedHow === "override" || blocker.clearedHow === "not_applicable") && (!note || !hasWordCharacter(note))) {
        errors[`${key}.resolutionNote`] =
          blocker.clearedHow === "override"
            ? "Explain why you're clearing it before the criteria are met."
            : "Explain why the clearing criteria don't apply.";
      }
    } else if (blocker.clearedHow) {
      errors[`${key}.clearedHow`] = "An active blocker can't have a clearing method.";
    }

    const identifiedError = dateError(blocker.identifiedDate, "date this blocker was noticed");
    if (identifiedError) errors[`${key}.identifiedDate`] = identifiedError;
    else if (compareISODate(blocker.identifiedDate, today) === 1) {
      errors[`${key}.identifiedDate`] = "A blocker can't be noticed in the future.";
    } else if (isRealDate(draft.createdDate) && compareISODate(blocker.identifiedDate, draft.createdDate) === -1) {
      errors[`${key}.identifiedDate`] = "A blocker can't be noticed before the decision was created.";
    }

    if (blocker.status === "resolved") {
      const resolvedError = dateError(blocker.resolvedDate, "date this blocker was cleared");
      if (resolvedError) errors[`${key}.resolvedDate`] = resolvedError;
      else if (compareISODate(blocker.resolvedDate, blocker.identifiedDate) === -1) {
        errors[`${key}.resolvedDate`] = "A blocker can't be cleared before it was noticed.";
      } else if (compareISODate(blocker.resolvedDate, today) === 1) {
        errors[`${key}.resolvedDate`] = "A blocker can't be cleared in the future.";
      }
    } else if (blocker.resolvedDate) {
      errors[`${key}.resolvedDate`] = "An active blocker can't have a cleared date.";
    }
  });
}

function validateWork(draft: DecisionDraft, errors: ErrorMap) {
  if (draft.blockedWork.length > MAX_WORK_ITEMS) {
    errors.blockedWork = `Record up to ${MAX_WORK_ITEMS} pieces of waiting work.`;
  }
  const titles = new Set<string>();
  const ids = new Set<string>();
  draft.blockedWork.forEach((item, index) => {
    const key = `blockedWork.${index}.title`;
    const title = cleanText(item.title);
    if (!item.id || ids.has(item.id)) errors[key] = "This work item has a duplicate identifier.";
    ids.add(item.id);
    if (!title || !hasWordCharacter(title)) errors[key] = "Name the work that is waiting.";
    else if (title.length > WORK_ITEM_MAX) errors[key] = `Keep work item names to ${WORK_ITEM_MAX} characters or fewer.`;
    else if (titles.has(title.toLowerCase())) errors[key] = "This work item is already linked to the decision.";
    titles.add(title.toLowerCase());
  });
}

function validateActions(draft: DecisionDraft, today: string, errors: ErrorMap) {
  if (draft.actions.length > MAX_ACTIONS) errors.actions = `Record up to ${MAX_ACTIONS} next steps.`;
  const blockerIds = new Set(draft.blockers.map((blocker) => blocker.id));
  const ids = new Set<string>();
  draft.actions.forEach((action, index) => {
    const key = `actions.${index}`;
    if (action.blockerId && !blockerIds.has(action.blockerId)) {
      errors[`${key}.blockerId`] = "This step points to a blocker that no longer exists. Choose another blocker or none.";
    }
    if (typeof action.done !== "boolean") errors[`${key}.done`] = "A step is either done or not done.";
    if (action.done && action.completedDate) {
      const err = dateError(action.completedDate, "completion date");
      if (err) errors[`${key}.completedDate`] = err;
      else if (compareISODate(action.completedDate, today) === 1) errors[`${key}.completedDate`] = "A step can't be completed in the future.";
    } else if (!action.done && action.completedDate) {
      errors[`${key}.completedDate`] = "An unfinished step can't have a completion date.";
    }
    if (action.suggestionKey.length > 200) errors[`${key}.description`] = "This step's suggestion reference could not be read.";
  });
  draft.actions.forEach((action, index) => {
    const key = `actions.${index}`;
    if (!action.id || ids.has(action.id)) errors[`${key}.description`] = "This step has a duplicate identifier.";
    ids.add(action.id);
    const description = cleanText(action.description);
    if (!description) errors[`${key}.description`] = "Describe the step, or remove it.";
    else if (!hasWordCharacter(description) || description.length < 3) {
      errors[`${key}.description`] = "Describe the step in a few words, such as \"Request the security report\".";
    } else textLimit(errors, `${key}.description`, description, ACTION_MAX, "step");
    textLimit(errors, `${key}.owner`, cleanText(action.owner), OWNER_MAX, "name");
    if (action.followUpDate.trim()) {
      const followError = dateError(action.followUpDate, "follow-up date");
      if (followError) errors[`${key}.followUpDate`] = followError;
      else if (isRealDate(draft.createdDate) && compareISODate(action.followUpDate, draft.createdDate) === -1) {
        errors[`${key}.followUpDate`] = "The follow-up date can't be before the decision was created.";
      }
    }
  });
}

export const EVIDENCE_SOURCES: EvidenceSourceType[] = ["document", "data", "conversation", "meeting", "website", "other"];
export const EVIDENCE_STATUSES: EvidenceStatus[] = ["unverified", "reviewed", "challenged"];

/**
 * Accepts only http and https links. The link is not fetched or checked;
 * the person stays responsible for judging the source.
 */
export function safeUrl(value: string): { url: string | null; error: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { url: null, error: null };
  if (trimmed.length > URL_MAX) return { url: null, error: "That link is too long." };
  if (/\s/.test(trimmed)) return { url: null, error: "A link can't contain spaces." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, error: "Enter a full link starting with https:// or http://." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { url: null, error: "Only https:// and http:// links can be saved." };
  }
  if (parsed.username || parsed.password) return { url: null, error: "Remove the username or password from the link." };
  if (!parsed.hostname) return { url: null, error: "Enter a full link starting with https:// or http://." };
  return { url: parsed.href, error: null };
}

function validateEvidence(draft: DecisionDraft, today: string, errors: ErrorMap) {
  if (draft.evidence.length > MAX_EVIDENCE) errors.evidence = `Record up to ${MAX_EVIDENCE} evidence entries.`;
  const blockerIds = new Set(draft.blockers.map((blocker) => blocker.id));
  const ids = new Set<string>();
  draft.evidence.forEach((item, index) => {
    const key = `evidence.${index}`;
    if (!item.id || ids.has(item.id)) errors[`${key}.title`] = "This evidence entry has a duplicate identifier.";
    ids.add(item.id);
    if (item.blockerId && !blockerIds.has(item.blockerId)) {
      errors[`${key}.blockerId`] = "This evidence points to a blocker that no longer exists.";
    }
    // The name is optional; the finding or question identifies the entry when it's blank.
    const title = cleanText(item.title);
    if (title && !hasWordCharacter(title)) errors[`${key}.title`] = "Use words for the evidence name.";
    else textLimit(errors, `${key}.title`, title, EVIDENCE_TITLE_MAX, "name");
    textLimit(errors, `${key}.question`, cleanText(item.question), BLOCKER_TEXT_MAX, "question");
    textLimit(errors, `${key}.sourceName`, cleanText(item.sourceName), SOURCE_NAME_MAX, "source");
    const summary = cleanText(item.summary);
    textLimit(errors, `${key}.summary`, summary, EVIDENCE_TEXT_MAX, "finding");
    textLimit(errors, `${key}.limitations`, cleanText(item.limitations), EVIDENCE_TEXT_MAX, "limitations");
    if (!EVIDENCE_SOURCES.includes(item.sourceType)) errors[`${key}.sourceType`] = "Choose what kind of source this is.";
    if (!EVIDENCE_STATUSES.includes(item.status)) errors[`${key}.status`] = "Choose a review status.";
    else if (item.status !== "unverified" && !summary) {
      errors[`${key}.status`] = "Record what was found before marking it reviewed or challenged.";
    }
    const link = safeUrl(item.url);
    if (link.error) errors[`${key}.url`] = link.error;
    if (item.collectedDate.trim()) {
      const err = dateError(item.collectedDate, "date collected");
      if (err) errors[`${key}.collectedDate`] = err;
      else if (compareISODate(item.collectedDate, today) === 1) errors[`${key}.collectedDate`] = "The collection date can't be in the future.";
    } else if (summary && item.status !== "unverified") {
      errors[`${key}.collectedDate`] = "Enter when this was collected before marking it reviewed or challenged.";
    }
    if (!summary && !cleanText(item.question)) {
      errors[`${key}.summary`] = "Record what was found, or the question it should answer.";
    }
  });
}

/** Which form step owns each error key. Step 4 is the review and shows everything. */
export function stepForErrorKey(key: string): number {
  if (key.startsWith("blockers") || key === "stage") return 1;
  if (key.startsWith("blockedWork") || ["impact", "stress", "urgency", "reversibility", "exposure"].includes(key)) return 2;
  if (key.startsWith("actions") || key === "dismissedSuggestions") return 3;
  if (key === "resolvedDate" || key === "resolutionNote" || key.startsWith("evidence") || key === "readinessOverride") return 4;
  return 0;
}

export function errorsForStep(result: { errors: ErrorMap }, step: number): ErrorMap {
  if (step >= 4) return result.errors;
  return Object.fromEntries(Object.entries(result.errors).filter(([key]) => stepForErrorKey(key) === step));
}

export function cleanDraft(draft: DecisionDraft): DecisionDraft {
  return {
    ...draft,
    title: cleanText(draft.title),
    description: cleanText(draft.description),
    category: cleanText(draft.category),
    owner: cleanText(draft.owner),
    resolutionNote: cleanText(draft.resolutionNote),
    readinessOverride: cleanText(draft.readinessOverride),
    blockers: draft.blockers.map((blocker) => ({
      ...blocker,
      description: cleanText(blocker.description),
      owner: cleanText(blocker.owner),
      resolvesWhen: cleanText(blocker.resolvesWhen),
      resolutionNote: cleanText(blocker.resolutionNote),
      details: Object.fromEntries(
        Object.entries(blocker.details ?? {})
          .map(([key, value]) => [key, typeof value === "string" ? cleanText(value) : value] as const)
          .filter(([, value]) => value !== ""),
      ),
      unknowns: [...new Set(blocker.unknowns ?? [])],
    })),
    blockedWork: draft.blockedWork.map((item) => ({ ...item, title: cleanText(item.title) })),
    actions: draft.actions.map((action) => ({
      ...action,
      description: cleanText(action.description),
      owner: cleanText(action.owner),
    })),
    evidence: draft.evidence.map((item) => ({
      ...item,
      title: cleanText(item.title),
      question: cleanText(item.question),
      sourceName: cleanText(item.sourceName),
      url: item.url.trim(),
      summary: cleanText(item.summary),
      limitations: cleanText(item.limitations),
    })),
  };
}

export function validateReopenReason(reason: string): string | null {
  const cleaned = cleanText(reason);
  if (!cleaned || !hasWordCharacter(cleaned)) return "Explain why the decision is being reopened.";
  if (cleaned.length > REOPEN_REASON_MAX) return `Keep the reason to ${REOPEN_REASON_MAX} characters or fewer.`;
  return null;
}
