"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  BLOCKER_GUIDES,
  OPEN_STAGES,
  REVERSIBILITY_LABELS,
  STAGE_LABELS,
  URGENCY_LABELS,
  blockerGuide,
  vagueTitleHint,
} from "../../lib/blockers";
import { DEPARTMENTS, MAX_ACTIONS, MAX_BLOCKERS, MAX_WORK_ITEMS, RATING_MAX, RATING_MIN, WORK_ITEM_MAX } from "../../lib/constants";
import {
  decisionToDraft,
  emptyDraft,
  knownWorkItems,
  newActionDraft,
  newBlockerDraft,
  newWorkItem,
  removeBlockerFromDraft,
} from "../../lib/data/decisions";
import { formatDisplayDate, localTodayISO } from "../../lib/dates";
import { guidanceInput, suggestActions } from "../../lib/guidance";
import { computeDebt } from "../../lib/scoring";
import type { ActionDraft, BlockerDraft, BlockerType, Decision, DecisionDraft, Reversibility, Urgency } from "../../lib/types";
import {
  DecisionValidationError,
  activeBlockerCount,
  cleanText,
  errorsForStep,
  hasErrors,
  stepForErrorKey,
  validateDecision,
  type ErrorMap,
} from "../../lib/validation";
import { useAppState } from "../providers/AppState";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Disclosure } from "../ui/Disclosure";
import { Field, controlClass } from "../ui/Field";
import { SuggestionCard } from "./BlockerTools";

const steps = ["Define the decision", "Identify blockers", "Waiting work", "Next steps", "Review"];

type WizardProps = {
  open: boolean;
  decision?: Decision | null;
  /** Answers carried over from Quick Start when the person chooses the full form. */
  initialDraft?: DecisionDraft;
  onClose: () => void;
};

function blockerLabel(blocker: { type: BlockerType; description: string }) {
  const text = blocker.description.trim();
  return `${blockerGuide(blocker.type).label}${text ? `: ${text.length > 50 ? `${text.slice(0, 47)}…` : text}` : ""}`;
}

export function DecisionWizard({ open, decision, initialDraft, onClose }: WizardProps) {
  const router = useRouter();
  const { decisions, saveDecision } = useAppState();
  const formId = useId();
  const today = localTodayISO();
  const [session] = useState(() => {
    const next = decision ? decisionToDraft(decision) : initialDraft ?? emptyDraft(localTodayISO());
    return { initial: JSON.stringify(next), submissionId: crypto.randomUUID(), draft: next };
  });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DecisionDraft>(session.draft);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [anyBlocker, setAnyBlocker] = useState<"yes" | "no" | null>(() =>
    session.draft.blockers.some((blocker) => blocker.status === "active") ? "yes" : decision ? "no" : null,
  );
  const [choosingType, setChoosingType] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const dirty = JSON.stringify(draft) !== session.initial;
  const savedBlockerIds = useMemo(() => new Set(decision?.blockers.map((blocker) => blocker.id) ?? []), [decision]);
  const editingResolved = Boolean(decision?.resolvedDate);

  useEffect(() => {
    if (!open || !dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, open]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const validation = useMemo(
    () => validateDecision(draft, { today, decisions, ignoreId: decision?.id }),
    [decision?.id, decisions, draft, today],
  );

  const otherDecisions = useMemo(() => decisions.filter((item) => item.id !== decision?.id), [decision?.id, decisions]);
  const guidance = useMemo(
    () =>
      suggestActions(guidanceInput({ ...draft, dueDate: draft.dueDate }), {
        today,
        decisions: otherDecisions.map((item) => ({ id: item.id, title: item.title, resolved: Boolean(item.resolvedDate) })),
      }),
    [draft, otherDecisions, today],
  );

  function clearErrors(prefix: string) {
    setErrors((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}.`)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }

  function update<K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearErrors(key);
    if (key === "blockers" || key === "stage") clearErrors("stage");
  }

  function updateBlocker(index: number, patch: Partial<BlockerDraft>) {
    setDraft((current) => ({
      ...current,
      blockers: current.blockers.map((blocker, i) => (i === index ? { ...blocker, ...patch } : blocker)),
    }));
    for (const key of Object.keys(patch)) clearErrors(`blockers.${index}.${key}`);
    clearErrors("stage");
  }

  function updateAction(index: number, patch: Partial<ActionDraft>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    }));
    for (const key of Object.keys(patch)) clearErrors(`actions.${index}.${key}`);
  }

  function addBlocker(type: BlockerType) {
    setDraft((current) => ({
      ...current,
      stage: current.stage === "ready_to_decide" ? "under_review" : current.stage,
      blockers: [...current.blockers, newBlockerDraft(type, today < current.createdDate ? current.createdDate : today)],
    }));
    setChoosingType(false);
    clearErrors("blockers");
    clearErrors("stage");
  }

  function removeBlocker(id: string) {
    // Errors are keyed by index, so they are recomputed on the next check.
    setDraft((current) => removeBlockerFromDraft(current, id));
    clearErrors("blockers");
    clearErrors("actions");
    clearErrors("stage");
  }

  function requestRemoveBlocker(id: string) {
    if (savedBlockerIds.has(id)) setPendingRemoval(id);
    else removeBlocker(id);
  }

  function requestClose() {
    if (dirty) {
      setConfirmCancel(true);
      return;
    }
    onClose();
  }

  function goNext() {
    const stepErrors = errorsForStep(validation, step);
    if (step === 1 && anyBlocker === null && !editingResolved) {
      stepErrors.anyBlocker = "Choose whether anything is preventing this decision from moving forward.";
    }
    setErrors(stepErrors);
    if (hasErrors({ errors: stepErrors })) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function save() {
    if (saving) return;
    const result = validateDecision(draft, { today: localTodayISO(), decisions, ignoreId: decision?.id });
    setErrors(result.errors);
    if (hasErrors(result)) {
      const first = Math.min(...Object.keys(result.errors).map(stepForErrorKey));
      if (first < steps.length - 1) setStep(first);
      return;
    }
    setSaving(true);
    try {
      const saved = saveDecision(draft, { id: decision?.id, submissionId: session.submissionId });
      onClose();
      router.push(`/decisions/${saved.id}`);
    } catch (error) {
      setSaving(false);
      if (error instanceof DecisionValidationError) setErrors(error.errors);
      else if (error instanceof Error) setErrors({ title: error.message });
    }
  }

  const activeCount = activeBlockerCount(draft);
  const titleHint = vagueTitleHint(draft.title);
  const savedResolved = new Set(session.draft.blockers.filter((blocker) => blocker.status === "resolved").map((blocker) => blocker.id));
  const editableBlockers = draft.blockers.map((blocker, index) => ({ blocker, index })).filter(({ blocker }) => !savedResolved.has(blocker.id));
  const clearedHistory = session.draft.blockers.filter((blocker) => blocker.status === "resolved");
  const pendingBlocker = draft.blockers.find((blocker) => blocker.id === pendingRemoval) ?? null;
  const pendingLinks = pendingBlocker
    ? draft.actions.filter((action) => action.blockerId === pendingBlocker.id).length +
      draft.evidence.filter((item) => item.blockerId === pendingBlocker.id).length
    : 0;
  const activeDraftBlockers = draft.blockers.filter((blocker) => blocker.status === "active");
  const moreErrors = Boolean(errors.description || errors.department || errors.category);

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        wide
        title={decision ? "Edit decision" : "Add a decision"}
        description={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}
      >
        <ol className="mb-5 grid grid-cols-5 gap-2" aria-label="Progress">
          {steps.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                disabled={index > step}
                onClick={() => setStep(index)}
                aria-current={index === step ? "step" : undefined}
                className="block w-full py-2 text-left disabled:cursor-default"
              >
                <span className={`block h-1.5 rounded-full ${index <= step ? "bg-teal" : "bg-line"}`} />
                <span className="sr-only">
                  {label}, {index === step ? "current step" : index < step ? "go back to this step" : "upcoming"}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <h3 ref={headingRef} tabIndex={-1} className="mb-4 text-lg font-semibold text-ink outline-none">
          {["What needs to be decided?", "Is anything preventing this decision from moving forward?", "What work is waiting on this decision?", "What would help move it forward?", "Review before saving"][step]}
        </h3>

        {step === 0 ? (
          <div className="grid gap-4">
            <Field
              id={`${formId}-title`}
              label="The decision"
              required
              error={errors.title}
              hint="Phrase it as the choice to be made, such as “Should we launch in November or January?”"
            >
              <input
                id={`${formId}-title`}
                className={controlClass}
                value={draft.title}
                maxLength={140}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={`${formId}-title-hint${titleHint ? ` ${formId}-title-suggest` : ""}`}
                onChange={(event) => update("title", event.target.value)}
              />
            </Field>
            {titleHint && !errors.title ? (
              <p id={`${formId}-title-suggest`} className="-mt-2 rounded-2xl bg-teal-soft px-4 py-2 text-sm text-ink" aria-live="polite">
                Suggestion: {titleHint} You can keep it as it is.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${formId}-owner`} label="Decision owner" error={errors.owner} hint="Optional. A name for your reference. Nobody is notified.">
                <input
                  id={`${formId}-owner`}
                  className={controlClass}
                  value={draft.owner}
                  aria-invalid={Boolean(errors.owner)}
                  onChange={(event) => update("owner", event.target.value)}
                />
              </Field>
              <div className="hidden sm:block" />
              <Field id={`${formId}-created`} label="Date identified" required error={errors.createdDate}>
                <input
                  id={`${formId}-created`}
                  type="date"
                  max={today}
                  className={controlClass}
                  value={draft.createdDate}
                  aria-invalid={Boolean(errors.createdDate)}
                  onChange={(event) => update("createdDate", event.target.value)}
                />
              </Field>
              <Field id={`${formId}-due`} label="Target decision date" error={errors.dueDate} hint="Optional. After this date it counts as overdue.">
                <input
                  id={`${formId}-due`}
                  type="date"
                  min={draft.createdDate || undefined}
                  className={controlClass}
                  value={draft.dueDate}
                  aria-invalid={Boolean(errors.dueDate)}
                  onChange={(event) => update("dueDate", event.target.value)}
                />
              </Field>
            </div>
            <Disclosure label="Context, department, and category (optional)" forceOpen={moreErrors}>
              <Field id={`${formId}-description`} label="Context" error={errors.description} hint="Background that someone new would need.">
                <textarea
                  id={`${formId}-description`}
                  className={`${controlClass} min-h-20`}
                  value={draft.description}
                  aria-invalid={Boolean(errors.description)}
                  onChange={(event) => update("description", event.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`${formId}-department`} label="Department" error={errors.department} hint="Used for the department chart.">
                  <select
                    id={`${formId}-department`}
                    className={controlClass}
                    value={draft.department}
                    aria-invalid={Boolean(errors.department)}
                    onChange={(event) => update("department", event.target.value)}
                  >
                    <option value="">Not set</option>
                    {DEPARTMENTS.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={`${formId}-category`} label="Category" error={errors.category} hint="Such as Pricing or Hiring.">
                  <input
                    id={`${formId}-category`}
                    className={controlClass}
                    value={draft.category}
                    aria-invalid={Boolean(errors.category)}
                    onChange={(event) => update("category", event.target.value)}
                  />
                </Field>
              </div>
            </Disclosure>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-5">
            {editingResolved ? (
              <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
                This decision is resolved. To add blockers or change its stage, reopen it from the decision page.
              </p>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="sr-only">Is anything preventing this decision from moving forward?</legend>
                <div className="flex flex-wrap gap-2">
                  {(["yes", "no"] as const).map((value) => {
                    const disabled = value === "no" && editableBlockers.some(({ blocker }) => blocker.status === "active");
                    return (
                      <label
                        key={value}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm ${anyBlocker === value ? "border-teal bg-teal-soft font-medium" : "border-line"} ${disabled ? "opacity-60" : ""}`}
                      >
                        <input
                          type="radio"
                          name={`${formId}-any-blocker`}
                          checked={anyBlocker === value}
                          disabled={disabled}
                          onChange={() => {
                            setAnyBlocker(value);
                            clearErrors("anyBlocker");
                            setChoosingType(value === "yes" && editableBlockers.length === 0);
                          }}
                        />
                        {value === "yes" ? "Yes, something is in the way" : "No, it's still being evaluated"}
                      </label>
                    );
                  })}
                </div>
                {anyBlocker === "no" && editableBlockers.length === 0 ? (
                  <p className="text-sm text-muted">That&apos;s fine. You can add a blocker later if one comes up.</p>
                ) : null}
                {editableBlockers.some(({ blocker }) => blocker.status === "active") ? (
                  <p className="text-sm text-muted">Remove the blockers below to choose “No”.</p>
                ) : null}
                {errors.anyBlocker ? (
                  <p role="alert" className="text-sm text-danger">
                    {errors.anyBlocker}
                  </p>
                ) : null}
              </fieldset>
            )}

            {editableBlockers.map(({ blocker, index }) => (
              <BlockerEditor
                key={blocker.id}
                formId={formId}
                blocker={blocker}
                index={index}
                errors={errors}
                today={today}
                createdDate={draft.createdDate}
                decisions={otherDecisions}
                onChange={(patch) => updateBlocker(index, patch)}
                onRemove={() => requestRemoveBlocker(blocker.id)}
              />
            ))}

            {anyBlocker === "yes" && !editingResolved && draft.blockers.length < MAX_BLOCKERS ? (
              choosingType || editableBlockers.length === 0 ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium text-ink">What kind of blocker is it?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {BLOCKER_GUIDES.map((guide) => (
                      <button
                        key={guide.type}
                        type="button"
                        onClick={() => addBlocker(guide.type)}
                        className="min-h-11 rounded-2xl border border-line px-4 py-3 text-left text-sm hover:border-teal/50 hover:bg-canvas"
                      >
                        <span className="block font-medium text-ink">{guide.label}</span>
                        <span className="mt-0.5 block leading-5 text-muted">{guide.explanation}</span>
                      </button>
                    ))}
                  </div>
                  {editableBlockers.length > 0 ? (
                    <Button variant="ghost" className="justify-self-start" onClick={() => setChoosingType(false)}>
                      Cancel
                    </Button>
                  ) : null}
                </fieldset>
              ) : (
                <Button variant="secondary" className="justify-self-start" onClick={() => setChoosingType(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add another blocker
                </Button>
              )
            ) : null}
            {errors.blockers ? (
              <p role="alert" className="text-sm text-danger">
                {errors.blockers}
              </p>
            ) : null}

            {clearedHistory.length > 0 ? (
              <div className="rounded-2xl border border-line px-4 py-3 text-sm">
                <p className="font-medium text-ink">Already cleared</p>
                <ul className="mt-1 grid gap-1 text-muted">
                  {clearedHistory.map((blocker) => (
                    <li key={blocker.id}>
                      {blockerLabel(blocker)}
                      {blocker.resolvedDate ? ` (cleared ${formatDisplayDate(blocker.resolvedDate)})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!editingResolved ? (
              <fieldset className="grid gap-2 border-t border-line pt-4">
                <legend className="mb-1 pt-4 text-sm font-medium text-ink">Where does the decision stand?</legend>
                <p className="-mt-1 text-sm text-muted">This is separate from blockers. A decision can be under review and blocked at the same time.</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[...OPEN_STAGES, { value: "resolved" as const, label: "Already decided", hint: "Record a decision that has been made." }]
                    .filter((option) => option.value !== "resolved" || !decision)
                    .map((option) => {
                      const disabled = (option.value === "ready_to_decide" || option.value === "resolved") && activeCount > 0;
                      return (
                        <label
                          key={option.value}
                          className={`flex min-h-11 items-start gap-2 rounded-2xl border px-3 py-2 text-sm ${
                            draft.stage === option.value ? "border-teal bg-teal-soft" : "border-line"
                          } ${disabled ? "opacity-60" : ""}`}
                        >
                          <input
                            type="radio"
                            className="mt-1"
                            name={`${formId}-stage`}
                            checked={draft.stage === option.value}
                            disabled={disabled}
                            onChange={() => {
                              update("stage", option.value);
                              if (option.value !== "resolved") {
                                update("resolvedDate", "");
                                update("resolutionNote", "");
                              } else if (!draft.resolvedDate) {
                                update("resolvedDate", today);
                              }
                            }}
                          />
                          <span>
                            <span className="block font-medium text-ink">{option.label}</span>
                            <span className="block text-muted">{disabled ? "Clear the active blockers first." : option.hint}</span>
                          </span>
                        </label>
                      );
                    })}
                </div>
                {errors.stage ? (
                  <p role="alert" className="text-sm text-danger">
                    {errors.stage}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <WorkAndImportance
            formId={formId}
            draft={draft}
            errors={errors}
            suggestions={knownWorkItems(otherDecisions)}
            onWork={(items) => update("blockedWork", items)}
            onUpdate={update}
          />
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            {guidance.suggestions.length > 0 ? (
              <section className="grid gap-3" aria-label="Suggested steps">
                <p className="text-sm text-muted">
                  Suggestions come from what you entered about the blockers. Review and edit before adding one; nothing is added on its own.
                </p>
                {guidance.suggestions.slice(0, 4).map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.key}
                    suggestion={suggestion}
                    confirmLabel="Add to steps"
                    withDetails
                    onAccept={({ description, owner, followUpDate }) => {
                      if (!cleanText(description)) return "Write the step before adding it.";
                      update("actions", [
                        ...draft.actions,
                        newActionDraft(today, { description, owner, followUpDate, blockerId: suggestion.blockerId ?? "", suggestionKey: suggestion.key }),
                      ]);
                      return null;
                    }}
                    onDismiss={() => update("dismissedSuggestions", [...draft.dismissedSuggestions, suggestion.key])}
                  />
                ))}
              </section>
            ) : null}
            {guidance.gaps.length > 0 ? (
              <ul className="grid gap-1 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
                {guidance.gaps.map((gap) => (
                  <li key={gap.blockerId}>{gap.message}</li>
                ))}
              </ul>
            ) : null}

            {draft.actions.map((action, index) => (
              <div key={action.id} className="grid gap-3 rounded-2xl border border-line p-4">
                <Field id={`${formId}-action-${action.id}`} label={`Step ${index + 1}`} required error={errors[`actions.${index}.description`]}>
                  <input
                    id={`${formId}-action-${action.id}`}
                    className={controlClass}
                    value={action.description}
                    aria-invalid={Boolean(errors[`actions.${index}.description`])}
                    onChange={(event) => updateAction(index, { description: event.target.value })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id={`${formId}-action-blocker-${action.id}`} label="Addresses" error={errors[`actions.${index}.blockerId`]}>
                    <select
                      id={`${formId}-action-blocker-${action.id}`}
                      className={controlClass}
                      value={action.blockerId}
                      onChange={(event) => updateAction(index, { blockerId: event.target.value })}
                    >
                      <option value="">No specific blocker</option>
                      {activeDraftBlockers.map((blocker) => (
                        <option key={blocker.id} value={blocker.id}>
                          {blockerLabel(blocker)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`${formId}-action-owner-${action.id}`} label="Who" error={errors[`actions.${index}.owner`]}>
                    <input
                      id={`${formId}-action-owner-${action.id}`}
                      className={controlClass}
                      value={action.owner}
                      onChange={(event) => updateAction(index, { owner: event.target.value })}
                    />
                  </Field>
                  <Field id={`${formId}-action-date-${action.id}`} label="Follow up on" error={errors[`actions.${index}.followUpDate`]}>
                    <input
                      id={`${formId}-action-date-${action.id}`}
                      type="date"
                      min={draft.createdDate || undefined}
                      className={controlClass}
                      value={action.followUpDate}
                      aria-invalid={Boolean(errors[`actions.${index}.followUpDate`])}
                      onChange={(event) => updateAction(index, { followUpDate: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={action.done}
                      onChange={(event) => updateAction(index, { done: event.target.checked, completedDate: event.target.checked ? action.completedDate : "" })}
                    />
                    Done
                  </label>
                  <Button variant="ghost" onClick={() => update("actions", draft.actions.filter((item) => item.id !== action.id))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Remove step
                  </Button>
                </div>
              </div>
            ))}
            {draft.actions.length < MAX_ACTIONS ? (
              <Button
                variant="secondary"
                className="justify-self-start"
                onClick={() =>
                  update("actions", [
                    ...draft.actions,
                    newActionDraft(today, { blockerId: activeDraftBlockers.length === 1 ? activeDraftBlockers[0].id : "" }),
                  ])
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Write your own step
              </Button>
            ) : null}
            {errors.actions ? (
              <p role="alert" className="text-sm text-danger">
                {errors.actions}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <Review formId={formId} draft={draft} errors={errors} warnings={validation.warnings} today={today} onEdit={setStep} onUpdate={update} />
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep((current) => current - 1)}>
                Back
              </Button>
            ) : null}
            {step < steps.length - 1 ? (
              <Button onClick={goNext}>Next</Button>
            ) : (
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save decision"}
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog open={confirmCancel} title="Discard unsaved changes?" onClose={() => setConfirmCancel(false)}>
        <p className="text-sm leading-6 text-muted">Nothing has been saved yet. Your entries stay here until you save or discard them.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmCancel(false);
              onClose();
            }}
          >
            Discard
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingBlocker)}
        title="Remove this blocker?"
        description="If it was dealt with, keep it and use Clear blocker on the decision page, so the history shows how it was resolved."
        onClose={() => setPendingRemoval(null)}
      >
        <p className="text-sm text-ink">{pendingBlocker?.description}</p>
        {pendingLinks > 0 ? (
          <p className="mt-2 text-sm text-muted">
            Its {pendingLinks} linked {pendingLinks === 1 ? "step or evidence entry" : "steps and evidence entries"} will be kept, without a blocker.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setPendingRemoval(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingRemoval) removeBlocker(pendingRemoval);
              setPendingRemoval(null);
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function BlockerEditor({
  formId,
  blocker,
  index,
  errors,
  today,
  createdDate,
  decisions,
  onChange,
  onRemove,
}: {
  formId: string;
  blocker: BlockerDraft;
  index: number;
  errors: ErrorMap;
  today: string;
  createdDate: string;
  decisions: Decision[];
  onChange: (patch: Partial<BlockerDraft>) => void;
  onRemove: () => void;
}) {
  const guide = blockerGuide(blocker.type);
  const base = `${formId}-blocker-${blocker.id.slice(0, 8)}`;
  const err = (field: string) => errors[`blockers.${index}.${field}`];
  const answered = blocker.description.trim().length > 0;
  const hasFollowUpError = Object.keys(errors).some((key) => key.startsWith(`blockers.${index}.details`));

  function setDetail(key: string, value: string) {
    onChange({ details: { ...blocker.details, [key]: value } });
  }

  function setUnknown(key: string, unknown: boolean) {
    const unknowns = unknown ? [...new Set([...blocker.unknowns, key])] : blocker.unknowns.filter((item) => item !== key);
    const details = { ...blocker.details };
    if (unknown) delete details[key];
    onChange({ unknowns, details });
  }

  return (
    <section aria-label={`Blocker: ${guide.label}`} className="grid gap-4 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Field id={`${base}-type`} label="Kind of blocker" error={err("type")}>
            <select
              id={`${base}-type`}
              className={controlClass}
              value={blocker.type}
              onChange={(event) => onChange({ type: event.target.value as BlockerType, details: {}, unknowns: [], dependsOnDecisionId: "" })}
            >
              {BLOCKER_GUIDES.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button variant="ghost" onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Remove
        </Button>
      </div>

      <Field id={`${base}-description`} label={guide.primary.label} required error={err("description")}>
        <textarea
          id={`${base}-description`}
          className={`${controlClass} min-h-16`}
          placeholder={guide.primary.placeholder}
          value={blocker.description}
          aria-invalid={Boolean(err("description"))}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Field>

      {answered || hasFollowUpError ? (
        <div className="grid gap-4 rounded-2xl bg-canvas p-4" aria-live="polite">
          <p className="text-sm text-muted">A few follow-up questions. Answer what you know; mark the rest as not known yet.</p>
          {blocker.type === "dependency" && decisions.length > 0 ? (
            <Field id={`${base}-upstream`} label="Is it a decision tracked here?" error={err("dependsOnDecisionId")} hint="Optional. Links to a decision saved in this browser.">
              <select
                id={`${base}-upstream`}
                className={controlClass}
                value={blocker.dependsOnDecisionId}
                onChange={(event) => onChange({ dependsOnDecisionId: event.target.value })}
              >
                <option value="">Not linked</option>
                {decisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.resolvedDate ? " (resolved)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {guide.followUps.map((question) => {
            const unknown = blocker.unknowns.includes(question.key);
            const id = `${base}-${question.key}`;
            return (
              <div key={question.key} className="grid gap-1.5">
                <Field id={id} label={question.label} error={err(`details.${question.key}`)}>
                  <input
                    id={id}
                    type={question.kind === "date" ? "date" : "text"}
                    max={question.kind === "date" ? today : undefined}
                    className={`${controlClass} disabled:bg-canvas disabled:text-muted`}
                    placeholder={unknown ? "Not known yet" : question.placeholder}
                    value={blocker.details[question.key] ?? ""}
                    disabled={unknown}
                    onChange={(event) => setDetail(question.key, event.target.value)}
                  />
                </Field>
                <label className="inline-flex min-h-9 items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={unknown} onChange={(event) => setUnknown(question.key, event.target.checked)} />
                  Not known yet
                </label>
              </div>
            );
          })}
          {err("details") ? (
            <p role="alert" className="text-sm text-danger">
              {err("details")}
            </p>
          ) : null}
          <Field id={`${base}-when`} label={guide.criteria.label} error={err("resolvesWhen")} hint="These are the clearing criteria. You'll check them before clearing the blocker.">
            <textarea
              id={`${base}-when`}
              className={`${controlClass} min-h-16`}
              placeholder={guide.criteria.placeholder}
              value={blocker.resolvesWhen}
              onChange={(event) => onChange({ resolvesWhen: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={`${base}-owner`} label="Who can help clear it" error={err("owner")} hint="Optional. A name only.">
              <input id={`${base}-owner`} className={controlClass} value={blocker.owner} onChange={(event) => onChange({ owner: event.target.value })} />
            </Field>
            <Field id={`${base}-follow`} label="Follow up on" error={err("followUpDate")} hint="Optional.">
              <input
                id={`${base}-follow`}
                type="date"
                min={createdDate || undefined}
                className={controlClass}
                value={blocker.followUpDate}
                aria-invalid={Boolean(err("followUpDate"))}
                onChange={(event) => onChange({ followUpDate: event.target.value })}
              />
            </Field>
            <Field id={`${base}-noticed`} label="Noticed on" required error={err("identifiedDate")}>
              <input
                id={`${base}-noticed`}
                type="date"
                min={createdDate || undefined}
                max={today}
                className={controlClass}
                value={blocker.identifiedDate}
                aria-invalid={Boolean(err("identifiedDate"))}
                onChange={(event) => onChange({ identifiedDate: event.target.value })}
              />
            </Field>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkAndImportance({
  formId,
  draft,
  errors,
  suggestions,
  onWork,
  onUpdate,
}: {
  formId: string;
  draft: DecisionDraft;
  errors: ErrorMap;
  suggestions: string[];
  onWork: (items: DecisionDraft["blockedWork"]) => void;
  onUpdate: <K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) => void;
}) {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState("");
  const listId = `${formId}-work-suggestions`;
  const taken = new Set(draft.blockedWork.map((item) => item.title.trim().toLowerCase()));
  const listErrors = Object.entries(errors).filter(([key]) => key.startsWith("blockedWork"));
  const importanceErrors = Boolean(errors.impact || errors.stress || errors.urgency || errors.reversibility || errors.exposure);

  function add() {
    const title = cleanText(entry);
    if (!title) {
      setEntryError("Type the name of the work first.");
      return;
    }
    if (title.length > WORK_ITEM_MAX) {
      setEntryError(`Keep work item names to ${WORK_ITEM_MAX} characters or fewer.`);
      return;
    }
    if (taken.has(title.toLowerCase())) {
      setEntryError("That work is already in the list.");
      return;
    }
    onWork([...draft.blockedWork, newWorkItem(title)]);
    setEntry("");
    setEntryError("");
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-muted">
          Projects, tasks, or launches that can&apos;t move until this is decided. Names used on other decisions are suggested so the same work is spelled the same way.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field id={`${formId}-work`} label="Waiting work" error={entryError || undefined}>
              <input
                id={`${formId}-work`}
                list={listId}
                className={controlClass}
                value={entry}
                placeholder="e.g., Marketing launch campaign"
                onChange={(event) => {
                  setEntry(event.target.value);
                  setEntryError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            </Field>
            <datalist id={listId}>
              {suggestions
                .filter((name) => !taken.has(name.toLowerCase()))
                .map((name) => (
                  <option key={name} value={name} />
                ))}
            </datalist>
          </div>
          <Button variant="secondary" onClick={add} disabled={draft.blockedWork.length >= MAX_WORK_ITEMS}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        {draft.blockedWork.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Work waiting on this decision">
            {draft.blockedWork.map((item) => (
              <li key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-canvas py-1 pl-4 pr-1 text-sm">
                <span className="break-words">{item.title}</span>
                <button
                  type="button"
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => onWork(draft.blockedWork.filter((other) => other.id !== item.id))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing listed. That&apos;s fine if nothing is waiting.</p>
        )}
        {listErrors.length > 0 ? (
          <p role="alert" className="text-sm text-danger">
            {listErrors.map(([, message]) => message).join(" ")}
          </p>
        ) : null}
      </div>

      <Disclosure label="Impact, stress, and other details (optional)" forceOpen={importanceErrors}>
        <p className="text-sm text-muted">Impact and stress feed the existing debt score and start at 3. The other fields are for your reference only.</p>
        <RatingField label="Impact" hint="How much this decision affects the work. 1 is slight, 5 is major." value={draft.impact} error={errors.impact} onChange={(value) => onUpdate("impact", value)} />
        <RatingField label="Stress" hint="How heavy it feels while it stays open. 1 is light, 5 is heavy." value={draft.stress} error={errors.stress} onChange={(value) => onUpdate("stress", value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${formId}-urgency`} label="Urgency" error={errors.urgency}>
            <select id={`${formId}-urgency`} className={controlClass} value={draft.urgency} onChange={(event) => onUpdate("urgency", event.target.value as "" | Urgency)}>
              <option value="">Not set</option>
              {Object.entries(URGENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-reversibility`} label="If it turns out wrong" error={errors.reversibility}>
            <select
              id={`${formId}-reversibility`}
              className={controlClass}
              value={draft.reversibility}
              onChange={(event) => onUpdate("reversibility", event.target.value as "" | Reversibility)}
            >
              <option value="">Not set</option>
              {Object.entries(REVERSIBILITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={`${formId}-exposure`} label="Rough amount at stake" error={errors.exposure} hint="Your own estimate in your currency, such as 25000. Not checked and not used in the score.">
          <input
            id={`${formId}-exposure`}
            inputMode="decimal"
            className={controlClass}
            value={draft.exposure}
            aria-invalid={Boolean(errors.exposure)}
            onChange={(event) => onUpdate("exposure", event.target.value)}
          />
        </Field>
      </Disclosure>
    </div>
  );
}

function Review({
  formId,
  draft,
  errors,
  warnings,
  today,
  onEdit,
  onUpdate,
}: {
  formId: string;
  draft: DecisionDraft;
  errors: ErrorMap;
  warnings: string[];
  today: string;
  onEdit: (step: number) => void;
  onUpdate: <K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) => void;
}) {
  const active = draft.blockers.filter((blocker) => blocker.status === "active");
  const openActions = draft.actions.filter((action) => !action.done);
  const remaining = Object.entries(errors).filter(([key]) => key !== "resolvedDate" && key !== "resolutionNote");
  const score = !errors.createdDate && !errors.impact && !errors.stress && draft.impact !== null && draft.stress !== null
    ? computeDebt({
        createdDate: draft.createdDate,
        dueDate: draft.dueDate || null,
        impact: draft.impact,
        stress: draft.stress,
        today: draft.stage === "resolved" && draft.resolvedDate ? noon(draft.resolvedDate) : new Date(),
      })
    : null;

  return (
    <div className="grid gap-3 text-sm">
      <ReviewSection title="What needs to be decided" onEdit={() => onEdit(0)}>
        <p className="break-words font-medium text-ink">{draft.title || "Not entered"}</p>
      </ReviewSection>
      <ReviewSection title="What's blocking it" onEdit={() => onEdit(1)}>
        {active.length === 0 ? (
          <p className="text-muted">Nothing recorded. Stage: {STAGE_LABELS[draft.stage]}.</p>
        ) : (
          <ul className="grid gap-1">
            {active.map((blocker) => (
              <li key={blocker.id} className="break-words">
                <span className="font-medium">{blockerGuide(blocker.type).label}:</span> {blocker.description}
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>
      <ReviewSection title="What work is waiting" onEdit={() => onEdit(2)}>
        <p className="break-words">{draft.blockedWork.length === 0 ? "None listed." : draft.blockedWork.map((item) => item.title).join(", ")}</p>
      </ReviewSection>
      <ReviewSection title="What happens next" onEdit={() => onEdit(3)}>
        {openActions.length === 0 ? (
          <p className="text-muted">No open step yet.</p>
        ) : (
          <ul className="grid gap-1">
            {openActions.map((action) => (
              <li key={action.id} className="break-words">
                {action.description}
                {action.followUpDate ? <span className="text-muted"> · follow up {formatDisplayDate(action.followUpDate)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      {draft.stage === "resolved" ? (
        <div className="grid gap-4 rounded-2xl border border-line p-4">
          <p className="font-medium text-ink">Outcome</p>
          <Field id={`${formId}-resolved`} label="Decided on" required error={errors.resolvedDate}>
            <input
              id={`${formId}-resolved`}
              type="date"
              min={draft.createdDate || undefined}
              max={today}
              className={controlClass}
              value={draft.resolvedDate}
              aria-invalid={Boolean(errors.resolvedDate)}
              onChange={(event) => onUpdate("resolvedDate", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-note`} label="What was decided" required error={errors.resolutionNote}>
            <textarea
              id={`${formId}-note`}
              className={`${controlClass} min-h-20`}
              value={draft.resolutionNote}
              aria-invalid={Boolean(errors.resolutionNote)}
              onChange={(event) => onUpdate("resolutionNote", event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <Disclosure label="Owner, dates, and score">
        <ReviewRow label="Decision owner" value={draft.owner || "Not set"} />
        <ReviewRow label="Date identified" value={draft.createdDate ? formatDisplayDate(draft.createdDate) : "Not entered"} />
        <ReviewRow label="Target date" value={draft.dueDate ? formatDisplayDate(draft.dueDate) : "None"} />
        <ReviewRow label="Department" value={draft.department || "Not set"} />
        <ReviewRow label="Impact / stress" value={`${draft.impact ?? "Not rated"} / ${draft.stress ?? "Not rated"}`} />
        {score && !score.invalid ? (
          <p className="rounded-2xl bg-canvas px-4 py-3 text-ink">
            Debt score so far: <span className="font-semibold tabular-nums">{score.debt}</span>. It measures how long a decision has been
            waiting, weighted by impact and stress, not how important it is. A new decision starts near 0 and grows while it stays open.
          </p>
        ) : draft.impact === null || draft.stress === null ? (
          <p className="rounded-2xl bg-canvas px-4 py-3 text-muted">No debt score until impact and stress are both set.</p>
        ) : null}
      </Disclosure>

      {remaining.length > 0 ? (
        <div role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-danger">
          Fix these before saving: {remaining.map(([, message]) => message).join(" ")}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-2xl bg-[#fff6ee] px-4 py-3 text-warning-text">
          <p className="font-medium">Worth a look (you can still save)</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="grid gap-1 rounded-2xl border border-line px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
        <button type="button" onClick={onEdit} className="min-h-11 rounded-xl px-3 text-sm font-medium text-teal hover:bg-canvas">
          Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </div>
      {children}
    </section>
  );
}

function RatingField({
  label,
  hint,
  value,
  error,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  error?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <p className="text-sm text-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        <label className="min-h-11">
          <input type="radio" className="peer sr-only" name={label} value="" checked={value === null} onChange={() => onChange(null)} />
          <span className="inline-flex h-11 items-center justify-center rounded-2xl border border-line px-4 text-sm peer-checked:border-teal peer-checked:bg-teal peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-teal">
            Not rated
          </span>
        </label>
        {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, index) => RATING_MIN + index).map((rating) => (
          <label key={rating} className="min-h-11 min-w-11">
            <input type="radio" className="peer sr-only" name={label} value={rating} checked={value === rating} onChange={() => onChange(rating)} />
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-line peer-checked:border-teal peer-checked:bg-teal peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-teal">
              {rating}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="max-w-[65%] break-words text-right font-medium">{value}</span>
    </div>
  );
}

function noon(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}
