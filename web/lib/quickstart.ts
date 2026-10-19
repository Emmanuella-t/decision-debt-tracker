import { QUICK_START_CHOICES } from "./blockers";
import { TITLE_MAX } from "./constants";
import { quickStartDraft } from "./data/decisions";
import type { DecisionDraft } from "./types";
import { cleanText } from "./validation";

const TITLE_MIN = 3;

/** Checks Quick Start's two answers before the shared validation runs on save. */
export function quickStartErrors(title: string, choice: string): { title?: string; choice?: string } {
  const errors: { title?: string; choice?: string } = {};
  const text = cleanText(title);
  if (!text) errors.title = "Write what you're trying to decide.";
  else if (text.length < TITLE_MIN || !/[\p{L}\p{N}]/u.test(text)) errors.title = "Add a few more words so it's clear later.";
  else if (text.length > TITLE_MAX) errors.title = `Keep it to ${TITLE_MAX} characters or fewer.`;
  if (!QUICK_START_CHOICES.some((item) => item.value === choice)) errors.choice = "Choose the closest answer. “I'm not sure yet” is fine.";
  return errors;
}

/** The draft Quick Start saves: the question, and at most one blocker of the chosen type. */
export function draftFromQuickStart(title: string, choice: string, today: string): DecisionDraft {
  const type = QUICK_START_CHOICES.find((item) => item.value === choice)?.type ?? null;
  return quickStartDraft({ title, blockerType: type }, today);
}
