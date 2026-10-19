"use client";

import { Check, ExternalLink, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { EVIDENCE_SOURCE_LABELS, EVIDENCE_STATUS_LABELS, blockerGuide } from "../../lib/blockers";
import { activeBlockers, actionsFor, clearanceWarnings, decisionToDraft, evidenceFor, newEvidenceDraft } from "../../lib/data/decisions";
import { formatDisplayDate, localTodayISO } from "../../lib/dates";
import type { Suggestion } from "../../lib/guidance";
import type { ClearedHow, Decision, DecisionDraft, Evidence, EvidenceDraft, EvidenceSourceType, EvidenceStatus } from "../../lib/types";
import { CLEARING_EXPLANATION_MIN, EVIDENCE_SOURCES, isClearingExplanation, type ErrorMap } from "../../lib/validation";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Disclosure } from "../ui/Disclosure";
import { Field, controlClass } from "../ui/Field";

export type SaveDraft = (draft: DecisionDraft, message: string) => ErrorMap | null;

/** Errors for one list entry, with the list prefix removed. */
export function scopedErrors(errors: ErrorMap, prefix: string): ErrorMap {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, value]) => [key.slice(prefix.length + 1), value]),
  );
}

function otherErrors(errors: ErrorMap, prefix: string): string[] {
  return Object.entries(errors)
    .filter(([key]) => !key.startsWith(`${prefix}.`))
    .map(([, value]) => value);
}

export function SuggestionCard({
  suggestion,
  confirmLabel,
  withDetails,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  confirmLabel: string;
  withDetails?: boolean;
  onAccept: (values: { description: string; owner: string; followUpDate: string }) => string | null;
  onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.text);
  const [owner, setOwner] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const base = `suggest-${suggestion.key.replace(/[^a-z0-9-]/gi, "-")}`;

  return (
    <div className="rounded-2xl border border-teal/30 bg-teal-soft/60 p-4 text-sm">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal">
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        Suggested step
      </p>
      {editing ? (
        <div className="mt-3 grid gap-3">
          <Field id={`${base}-text`} label="Step" required error={error || undefined}>
            <textarea id={`${base}-text`} className={`${controlClass} min-h-16`} value={text} onChange={(event) => setText(event.target.value)} />
          </Field>
          {withDetails ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`${base}-owner`} label="Who" hint="Optional. A name only.">
                <input id={`${base}-owner`} className={controlClass} value={owner} onChange={(event) => setOwner(event.target.value)} />
              </Field>
              <Field id={`${base}-date`} label="Follow up on" hint="Optional.">
                <input id={`${base}-date`} type="date" className={controlClass} value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const result = onAccept({ description: text, owner, followUpDate: date });
                if (result) setError(result);
              }}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {confirmLabel}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 font-medium leading-6 text-ink">{suggestion.text}</p>
          <p className="mt-1 leading-6 text-muted">
            <span className="font-medium text-ink">Why: </span>
            {suggestion.why}
          </p>
          <p className="mt-1 text-xs text-muted">Based on: {suggestion.basedOn.join(", ")}</p>
          {suggestion.similarTo ? (
            <p className="mt-1 break-words text-xs text-muted">
              Similar wording to your step &ldquo;{suggestion.similarTo}&rdquo;. Dismiss this if it&apos;s the same.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Review and use
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              <X className="h-4 w-4" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<EvidenceStatus, string> = {
  unverified: "bg-canvas text-ink",
  reviewed: "bg-teal-soft text-ink",
  challenged: "bg-[#fff6ee] text-warning-text",
};

/** The evidence name, or the start of the finding or question when no name was given. */
export function evidenceName(item: Pick<Evidence, "title" | "summary" | "question">): string {
  const text = (item.title || item.summary || item.question).trim().replace(/\s+/g, " ");
  return text.length > 70 ? `${text.slice(0, 69).trimEnd()}…` : text || "Untitled";
}

export function StatusBadge({ status }: { status: EvidenceStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{EVIDENCE_STATUS_LABELS[status]}</span>;
}

export function EvidenceItem({
  item,
  onEdit,
  onStatus,
}: {
  item: Evidence;
  onEdit?: () => void;
  onStatus?: (status: EvidenceStatus) => void;
}) {
  const open = !item.summary.trim();
  let host = "";
  if (item.url) {
    try {
      host = new URL(item.url).hostname;
    } catch {
      host = "";
    }
  }
  return (
    <li className="grid gap-2 rounded-2xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {item.title ? <span className="font-semibold text-ink">{item.title}</span> : null}
        {open ? <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink">Open question</span> : <StatusBadge status={item.status} />}
      </div>
      {item.question ? (
        <p className="text-muted">
          <span className="font-medium text-ink">Question: </span>
          {item.question}
        </p>
      ) : null}
      {item.summary ? <p className="whitespace-pre-line leading-6 text-ink">{item.summary}</p> : null}
      {item.limitations ? (
        <p className="whitespace-pre-line text-muted">
          <span className="font-medium text-ink">Limitations: </span>
          {item.limitations}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {EVIDENCE_SOURCE_LABELS[item.sourceType]}
        {item.sourceName ? ` · ${item.sourceName}` : ""}
        {item.collectedDate ? ` · collected ${formatDisplayDate(item.collectedDate)}` : ""}
      </p>
      {item.url && host ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm font-medium text-teal underline-offset-2 hover:underline"
        >
          {host}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab; not checked by this app)</span>
        </a>
      ) : null}
      {onEdit || onStatus ? (
        <div className="flex flex-wrap gap-2">
          {onEdit ? (
            <Button variant="secondary" onClick={onEdit}>
              {open ? "Record finding" : "Edit"}
            </Button>
          ) : null}
          {onStatus && !open ? (
            <>
              {item.status !== "reviewed" ? (
                <Button variant="ghost" onClick={() => onStatus("reviewed")}>
                  Mark reviewed
                </Button>
              ) : null}
              {item.status !== "challenged" ? (
                <Button variant="ghost" onClick={() => onStatus("challenged")}>
                  Mark challenged
                </Button>
              ) : null}
              {item.status !== "unverified" ? (
                <Button variant="ghost" onClick={() => onStatus("unverified")}>
                  Mark not reviewed
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function EvidenceDialog({
  decision,
  evidenceId,
  defaultBlockerId,
  onClose,
  save,
}: {
  decision: Decision;
  evidenceId?: string;
  defaultBlockerId: string;
  onClose: () => void;
  save: SaveDraft;
}) {
  const existing = evidenceId ? decisionToDraft(decision).evidence.find((item) => item.id === evidenceId) : undefined;
  const [entry, setEntry] = useState<EvidenceDraft>(() => existing ?? newEvidenceDraft(defaultBlockerId));
  const [errors, setErrors] = useState<ErrorMap>({});
  const [general, setGeneral] = useState<string[]>([]);
  const today = localTodayISO();
  const blockers = decision.blockers;

  function set<K extends keyof EvidenceDraft>(key: K, value: EvidenceDraft[K]) {
    setEntry((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function submit() {
    const draft = decisionToDraft(decision);
    const index = existing ? draft.evidence.findIndex((item) => item.id === entry.id) : draft.evidence.length;
    if (existing) draft.evidence[index] = entry;
    else draft.evidence.push(entry);
    const result = save(draft, existing ? "Evidence updated." : "Evidence added.");
    if (!result) {
      onClose();
      return;
    }
    setErrors(scopedErrors(result, `evidence.${index}`));
    setGeneral(otherErrors(result, `evidence.${index}`));
  }

  const advancedKeys = ["title", "blockerId", "question", "sourceType", "url", "collectedDate", "limitations", "status"] as const;
  const advancedError = advancedKeys.some((key) => errors[key]);
  const advancedUsed = Boolean(existing && (existing.title || existing.question || existing.url || existing.collectedDate || existing.limitations || existing.status !== "unverified"));

  return (
    <Dialog open title={existing ? "Edit supporting information" : "Add supporting information"} description="Links aren't opened or checked by the app." onClose={onClose}>
      <div className="grid gap-4">
        <Field id="ev-summary" label="What did you find?" error={errors.summary}>
          <textarea id="ev-summary" className={`${controlClass} min-h-24`} value={entry.summary} aria-invalid={Boolean(errors.summary)} onChange={(event) => set("summary", event.target.value)} />
        </Field>
        <Field id="ev-source" label="Where did it come from?" error={errors.sourceName} hint="Optional. A person, team, or document.">
          <input id="ev-source" className={controlClass} value={entry.sourceName} onChange={(event) => set("sourceName", event.target.value)} />
        </Field>
        <Disclosure label="More fields" forceOpen={advancedError} defaultOpen={advancedUsed}>
        <Field id="ev-title" label="Short name" error={errors.title} hint="Optional. e.g., Finance demand forecast, Q3">
          <input id="ev-title" className={controlClass} value={entry.title} aria-invalid={Boolean(errors.title)} onChange={(event) => set("title", event.target.value)} />
        </Field>
        <Field id="ev-blocker" label="Blocker it relates to" error={errors.blockerId}>
          <select id="ev-blocker" className={controlClass} value={entry.blockerId} onChange={(event) => set("blockerId", event.target.value)}>
            <option value="">Not linked to a blocker</option>
            {blockers.map((blocker) => (
              <option key={blocker.id} value={blocker.id}>
                {blockerGuide(blocker.type).label}: {blocker.description.slice(0, 60) || "No description"}
                {blocker.status === "resolved" ? " (cleared)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field id="ev-question" label="Research question" error={errors.question} hint="Optional. Leave the finding empty to track an open question.">
          <input id="ev-question" className={controlClass} value={entry.question} onChange={(event) => set("question", event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ev-source-type" label="Kind of source" error={errors.sourceType}>
            <select id="ev-source-type" className={controlClass} value={entry.sourceType} onChange={(event) => set("sourceType", event.target.value as EvidenceSourceType)}>
              {EVIDENCE_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {EVIDENCE_SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ev-date" label="Date collected" error={errors.collectedDate} hint="Needed before marking it reviewed.">
            <input id="ev-date" type="date" max={today} className={controlClass} value={entry.collectedDate} aria-invalid={Boolean(errors.collectedDate)} onChange={(event) => set("collectedDate", event.target.value)} />
          </Field>
        </div>
        <Field id="ev-url" label="Link" error={errors.url} hint="Optional. https:// or http:// only.">
          <input id="ev-url" type="url" inputMode="url" className={controlClass} value={entry.url} aria-invalid={Boolean(errors.url)} onChange={(event) => set("url", event.target.value)} />
        </Field>
        <Field id="ev-limits" label="Limitations" error={errors.limitations} hint="Optional. e.g., based on last year's data only">
          <textarea id="ev-limits" className={`${controlClass} min-h-16`} value={entry.limitations} onChange={(event) => set("limitations", event.target.value)} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-ink">Review status</legend>
          <p className="text-sm text-muted">&ldquo;Reviewed&rdquo; means you judged it usable, not that it&apos;s verified.</p>
          <div className="flex flex-wrap gap-2">
            {(["unverified", "reviewed", "challenged"] as const).map((status) => (
              <label key={status} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${entry.status === status ? "border-teal bg-teal-soft" : "border-line"}`}>
                <input type="radio" name="ev-status" checked={entry.status === status} onChange={() => set("status", status)} />
                {EVIDENCE_STATUS_LABELS[status]}
              </label>
            ))}
          </div>
          {errors.status ? (
            <p role="alert" className="text-sm text-danger">
              {errors.status}
            </p>
          ) : null}
        </fieldset>
        </Disclosure>
        {general.length > 0 ? (
          <p role="alert" className="text-sm text-danger">
            {general.join(" ")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ClearBlockerDialog({
  decision,
  blockerId,
  onClose,
  save,
}: {
  decision: Decision;
  blockerId: string;
  onClose: () => void;
  save: SaveDraft;
}) {
  const blocker = activeBlockers(decision).find((item) => item.id === blockerId);
  const hasCriteria = Boolean(blocker?.resolvesWhen.trim());
  const openItems = blocker ? clearanceWarnings(decision, blocker) : [];
  const [how, setHow] = useState<ClearedHow | "">(hasCriteria && openItems.length === 0 ? "criteria_met" : "");
  const [reason, setReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [date, setDate] = useState(localTodayISO());
  const [error, setError] = useState("");
  if (!blocker) return null;
  const steps = actionsFor(decision, blocker.id);
  const evidence = evidenceFor(decision, blocker.id);
  const index = decision.blockers.findIndex((item) => item.id === blocker.id);
  const explanationRequired = how === "override" || how === "not_applicable" || (how === "criteria_met" && openItems.length > 0);
  const reasonLabel =
    how === "not_applicable"
      ? "Why don't the criteria apply?"
      : how === "override"
        ? "Why clear it now?"
        : openItems.length > 0
          ? "Why are the criteria met despite the open items?"
          : "Note (optional)";

  function submit() {
    if (!how) {
      setError("Choose whether the clearing criteria were met.");
      return;
    }
    if (explanationRequired && !isClearingExplanation(reason)) {
      setError(`Explain your choice in at least ${CLEARING_EXPLANATION_MIN} characters. It's kept in the history.`);
      return;
    }
    const draft = decisionToDraft(decision);
    const resolvedDate = correcting ? date : localTodayISO();
    draft.blockers[index] = { ...draft.blockers[index], status: "resolved", resolvedDate, resolutionNote: reason, clearedHow: how };
    const result = save(draft, "Blocker cleared.");
    if (!result) {
      onClose();
      return;
    }
    setError(Object.values(result).join(" "));
  }

  return (
    <Dialog open wide title="Clear this blocker?" description="Check what was agreed would clear it. Nothing is cleared automatically." onClose={onClose}>
      <div className="grid gap-4 text-sm">
        <section className="rounded-2xl bg-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{blockerGuide(blocker.type).label}</p>
          <p className="mt-1 whitespace-pre-line font-medium text-ink">{blocker.description}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">What would clear it</p>
          <p className="mt-1 whitespace-pre-line text-ink">{hasCriteria ? blocker.resolvesWhen : "No clearing criteria were written down."}</p>
        </section>
        <section>
          <h3 className="font-semibold text-ink">Linked steps</h3>
          {steps.length === 0 ? (
            <p className="mt-1 text-muted">None linked.</p>
          ) : (
            <ul className="mt-1 grid gap-1">
              {steps.map((step) => (
                <li key={step.id} className={step.done ? "text-muted" : "text-ink"}>
                  {step.done ? "Done: " : "Not done: "}
                  {step.description}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="font-semibold text-ink">Evidence</h3>
          {evidence.length === 0 ? (
            <p className="mt-1 text-muted">None recorded.</p>
          ) : (
            <ul className="mt-1 grid gap-1">
              {evidence.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  {evidenceName(item)}
                  {item.summary ? <StatusBadge status={item.status} /> : <span className="text-muted">(open question)</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        {evidence.length > 0 ? (
          <p className="text-xs text-muted">&ldquo;Reviewed&rdquo; means someone using this app marked it reviewed. The app doesn&apos;t verify evidence.</p>
        ) : null}
        {openItems.length > 0 ? (
          <div className="rounded-2xl bg-[#fff6ee] px-4 py-3 text-warning-text">
            <p className="font-medium">Still open:</p>
            <ul className="mt-1 list-disc pl-5">
              {openItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-2">Clearing will need an explanation, and these items are recorded with it.</p>
          </div>
        ) : null}
        <p className="text-muted">Clearing doesn&apos;t mark steps done, review evidence, or resolve the decision.</p>
        <fieldset className="grid gap-2">
          <legend className="font-medium text-ink">Have the clearing criteria been met?</legend>
          {[
            {
              value: "criteria_met" as const,
              label: "Yes, the criteria are met",
              hint: !hasCriteria ? "Write the criteria first, or choose another option." : openItems.length > 0 ? "Explain why, given the open items." : "",
              disabled: !hasCriteria,
            },
            { value: "not_applicable" as const, label: "The criteria don't apply", hint: "Explain why." },
            { value: "override" as const, label: "Clear it anyway", hint: "Explain why it's no longer in the way." },
          ].map((option) => (
            <label key={option.value} className={`flex min-h-11 items-start gap-3 rounded-2xl border px-4 py-3 ${how === option.value ? "border-teal bg-teal-soft" : "border-line"} ${option.disabled ? "opacity-60" : ""}`}>
              <input type="radio" className="mt-1" name="clear-how" disabled={option.disabled} checked={how === option.value} onChange={() => { setHow(option.value); setError(""); }} />
              <span>
                <span className="block font-medium text-ink">{option.label}</span>
                {option.hint ? <span className="block text-muted">{option.hint}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
        <Field id="clear-reason" label={reasonLabel} required={explanationRequired}>
          <textarea id="clear-reason" className={`${controlClass} min-h-20`} value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} />
        </Field>
        <div className="grid gap-2">
          <p className="text-muted">Recorded as cleared today. The history keeps the time you save this.</p>
          <label className="inline-flex min-h-11 items-center gap-2 text-ink">
            <input type="checkbox" checked={correcting} onChange={(event) => setCorrecting(event.target.checked)} />
            It was actually cleared on an earlier date
          </label>
          {correcting ? (
            <Field id="clear-date" label="Date it was actually cleared (correction)" hint="Shown in the history as a date you entered.">
              <input id="clear-date" type="date" className={controlClass} min={blocker.identifiedDate} max={localTodayISO()} value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Clear blocker</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ReadinessDialog({ decision, onClose, save }: { decision: Decision; onClose: () => void; save: SaveDraft }) {
  const [reason, setReason] = useState(decision.readinessOverride?.reason ?? "");
  const [error, setError] = useState("");
  const remaining = activeBlockers(decision).length;
  return (
    <Dialog
      open
      title="Treat it as ready to decide?"
      description="Use this when you judge there's enough to decide even though some items are open. The open items stay listed."
      onClose={onClose}
    >
      {remaining > 0 ? (
        <p className="mb-4 rounded-2xl bg-[#fff6ee] px-4 py-3 text-sm text-warning-text">
          {remaining} {remaining === 1 ? "blocker is" : "blockers are"} still active. The stage won&apos;t change to Ready to decide until they&apos;re cleared.
        </p>
      ) : null}
      <Field id="ready-reason" label="Why is it ready anyway?" required error={error || undefined}>
        <textarea id="ready-reason" className={`${controlClass} min-h-20`} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (!reason.trim()) {
              setError("Explain in a few words why it's ready anyway.");
              return;
            }
            const draft = decisionToDraft(decision);
            draft.readinessOverride = reason;
            const result = save(draft, "Readiness note saved.");
            if (result) setError(Object.values(result).join(" "));
            else onClose();
          }}
        >
          Save note
        </Button>
      </div>
    </Dialog>
  );
}
