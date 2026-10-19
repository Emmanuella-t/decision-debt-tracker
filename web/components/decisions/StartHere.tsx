"use client";

import { useId, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { blockerGuide } from "../../lib/blockers";
import { formatDisplayDate } from "../../lib/dates";
import type { NextBestStep, Suggestion } from "../../lib/guidance";
import type { Decision } from "../../lib/types";
import { cleanText } from "../../lib/validation";
import { Button } from "../ui/Button";
import { Field, controlClass } from "../ui/Field";

export type StepValues = { description: string; owner: string; followUpDate: string };

export type GuidanceHandlers = {
  onAnswer: (blockerId: string, key: string, value: string) => string | null;
  onAccept: (suggestion: Suggestion, values: StepValues) => string | null;
  onDismiss: (suggestion: Suggestion) => void;
  onToggle: (actionId: string, done: boolean) => void;
  onEditAction: (actionId: string, values: StepValues) => string | null;
};

/**
 * One next step at a time: an existing step, a suggestion that becomes a
 * step once confirmed, or a single question that makes the guidance specific.
 * Nothing is saved without an explicit button press.
 */
export function GuidanceCard({
  decision,
  best,
  heading,
  compact,
  onAddInfo,
  onViewSteps,
  ...handlers
}: {
  decision: Decision;
  best: NextBestStep;
  heading?: string;
  compact?: boolean;
  onAddInfo?: () => void;
  onViewSteps?: () => void;
} & GuidanceHandlers) {
  const ids = useId();
  const [mode, setMode] = useState<"idle" | "answer" | "step">("idle");
  const [answer, setAnswer] = useState("");
  const action = best.kind === "action" ? decision.actions[best.index] : undefined;
  const suggestion = best.kind === "suggestion" ? best.suggestion : undefined;
  const [values, setValues] = useState<StepValues>(() => ({
    description: action?.description ?? suggestion?.text ?? "",
    owner: action?.owner ?? "",
    followUpDate: action?.followUpDate ?? "",
  }));
  const [error, setError] = useState("");

  const blockerId = suggestion?.blockerId ?? action?.blockerId ?? null;
  const blocker = blockerId ? decision.blockers.find((item) => item.id === blockerId && item.status === "active") : undefined;
  const shell = compact ? "rounded-2xl border border-teal/30 bg-teal-soft/50 p-4" : "rounded-card border border-teal/30 bg-teal-soft/50 p-5 sm:p-6";

  if (best.kind === "none") {
    return (
      <section className={shell}>
        {heading ? <p className="text-xs font-semibold uppercase tracking-wide text-teal">{heading}</p> : null}
        <p className="mt-2 text-ink">{best.message}</p>
      </section>
    );
  }

  const text = best.kind === "action" ? best.text : best.suggestion.text;
  const why = best.kind === "action" ? best.why : best.suggestion.why;

  function saveAnswer() {
    if (!suggestion?.ask || !suggestion.blockerId) return;
    const value = cleanText(answer);
    if (value.length < 3) {
      setError("Add a few words.");
      return;
    }
    const result = handlers.onAnswer(suggestion.blockerId, suggestion.ask.key, value);
    if (result) setError(result);
    else {
      setMode("idle");
      setAnswer("");
    }
  }

  function saveStep() {
    if (!cleanText(values.description)) {
      setError("Say what needs to happen.");
      return;
    }
    const result = action ? handlers.onEditAction(action.id, values) : suggestion ? handlers.onAccept(suggestion, values) : null;
    if (result) setError(result);
    else setMode("idle");
  }

  return (
    <section className={shell} aria-labelledby={`${ids}-text`}>
      {heading ? <p className="text-xs font-semibold uppercase tracking-wide text-teal">{heading}</p> : null}
      {blocker && !compact ? <p className="mt-1 text-sm text-muted">Holding it up: {blockerGuide(blocker.type).label}</p> : null}
      <p id={`${ids}-text`} className={`mt-2 break-words font-semibold leading-snug text-ink ${compact ? "text-base" : "text-xl"}`}>
        {text}
      </p>
      <p className="mt-1 text-sm text-muted">{why}</p>
      {action ? (
        <p className="mt-2 text-sm text-muted">
          {action.owner || "No one named"}
          {action.followUpDate ? ` · follow up ${formatDisplayDate(action.followUpDate)}` : ""}
          {best.kind === "action" && best.overdue ? <span className="font-medium text-warning-text"> · follow-up date has passed</span> : null}
        </p>
      ) : null}
      {suggestion?.similarTo ? (
        <p className="mt-2 break-words text-xs text-muted">Similar to your step &ldquo;{suggestion.similarTo}&rdquo;. Dismiss this if it&apos;s the same.</p>
      ) : null}

      {mode === "answer" && suggestion?.ask ? (
        <div className="mt-4 grid gap-3">
          <Field id={`${ids}-answer`} label={suggestion.ask.label} error={error || undefined}>
            <textarea
              id={`${ids}-answer`}
              autoFocus
              className={`${controlClass} min-h-20`}
              placeholder={suggestion.ask.placeholder}
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value);
                setError("");
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveAnswer}>Save</Button>
            <Button variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "step" ? (
        <div className="mt-4 grid gap-3">
          <Field id={`${ids}-what`} label="What needs to happen?" required error={error || undefined}>
            <textarea
              id={`${ids}-what`}
              autoFocus
              className={`${controlClass} min-h-16`}
              value={values.description}
              onChange={(event) => {
                setValues({ ...values, description: event.target.value });
                setError("");
              }}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${ids}-who`} label="Who will handle it?" hint="Optional.">
              <input id={`${ids}-who`} className={controlClass} value={values.owner} onChange={(event) => setValues({ ...values, owner: event.target.value })} />
            </Field>
            <Field id={`${ids}-when`} label="When should we follow up?" hint="Optional.">
              <input id={`${ids}-when`} type="date" className={controlClass} value={values.followUpDate} onChange={(event) => setValues({ ...values, followUpDate: event.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveStep}>Save step</Button>
            <Button variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {action ? (
            <>
              <Button onClick={() => handlers.onToggle(action.id, true)}>Mark done</Button>
              <Button variant="secondary" onClick={() => setMode("step")}>
                Edit
              </Button>
            </>
          ) : suggestion ? (
            <>
              <Button onClick={() => setMode(suggestion.ask ? "answer" : "step")}>
                Work on this
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="ghost" onClick={() => handlers.onDismiss(suggestion)}>
                <X className="h-4 w-4" aria-hidden="true" />
                Dismiss
              </Button>
            </>
          ) : null}
          {onAddInfo && blocker?.type === "missing_information" ? (
            <Button variant="ghost" onClick={onAddInfo}>
              Add supporting information
            </Button>
          ) : null}
          {onViewSteps ? (
            <Button variant="ghost" onClick={onViewSteps}>
              View all steps
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
