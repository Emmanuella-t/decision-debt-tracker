"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { REVERSIBILITY_LABELS, STAGE_LABELS, URGENCY_LABELS, blockerGuide } from "../../lib/blockers";
import {
  activeBlockers,
  actionsFor,
  decisionToDraft,
  evidenceFor,
  isValidRecord,
  newActionDraft,
  withDebt,
} from "../../lib/data/decisions";
import { compareISODate, formatDisplayDate, formatEventTime, localTodayISO } from "../../lib/dates";
import { guidanceInput, nextBestStep, suggestActions, type Suggestion } from "../../lib/guidance";
import { blockerLabels, deriveReadiness } from "../../lib/readiness";
import type { Blocker, Decision, EvidenceStatus, LifecycleEventType, NextAction } from "../../lib/types";
import { DecisionValidationError, cleanText, type ErrorMap } from "../../lib/validation";
import { useAppState } from "../providers/AppState";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Disclosure } from "../ui/Disclosure";
import { Field, controlClass } from "../ui/Field";
import { ClearBlockerDialog, EvidenceDialog, EvidenceItem, ReadinessDialog, type SaveDraft } from "./BlockerTools";
import { DecisionWizard } from "./DecisionWizard";
import { GuidanceCard, type GuidanceHandlers, type StepValues } from "./StartHere";

const tabs = ["Overview", "Blockers", "Waiting work", "Next steps", "History"] as const;
type Tab = (typeof tabs)[number];

const EVENT_LABELS: Record<LifecycleEventType, string> = {
  created: "Created",
  updated: "Edited",
  stage_changed: "Stage changed",
  blocker_added: "Blocker added",
  blocker_updated: "Blocker updated",
  blocker_removed: "Blocker removed",
  blocker_resolved: "Blocker cleared",
  action_added: "Step added",
  action_linked: "Step linked to a blocker",
  action_completed: "Step completed",
  evidence_added: "Evidence added",
  evidence_updated: "Evidence edited",
  evidence_status_changed: "Evidence status changed",
  readiness_noted: "Readiness note",
  resolved: "Resolved",
  reopened: "Reopened",
};

function messageOf(error: unknown, fallback: string) {
  if (error instanceof DecisionValidationError) return Object.values(error.errors).join(" ");
  if (error instanceof Error) return error.message;
  return fallback;
}

type EvidenceTarget = { evidenceId?: string; blockerId: string } | null;

export function DecisionDetail({ id }: { id: string }) {
  const { ready, decisions, saveDecision, resolveDecision, reopenDecision } = useAppState();
  const decision = decisions.find((item) => item.id === id) ?? null;
  const [tab, setTab] = useState<Tab>("Overview");
  const [editing, setEditing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget>(null);
  const [noting, setNoting] = useState(false);
  const [pageError, setPageError] = useState("");
  const tabIds = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const score = useMemo(() => (decision && isValidRecord(decision) ? withDebt(decision, new Date()) : null), [decision]);
  const today = localTodayISO();

  const guidance = useMemo(() => {
    if (!decision) return null;
    const input = guidanceInput(decision);
    const result = suggestActions(input, {
      today,
      decisions: decisions.filter((item) => item.id !== decision.id).map((item) => ({ id: item.id, title: item.title, resolved: Boolean(item.resolvedDate) })),
    });
    return { input, result, best: nextBestStep(input, result, today) };
  }, [decision, decisions, today]);

  if (!ready) return <p className="text-sm text-muted">Loading decision…</p>;
  if (!decision || !guidance) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 shadow-card">
        <h1 className="text-2xl font-semibold">Decision not found</h1>
        <p className="mt-2 text-sm text-muted">Decisions are stored in this browser only. It may have been saved on another device or browser.</p>
        <Link href="/decisions" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-teal">
          Back to decisions
        </Link>
      </div>
    );
  }
  const current = decision;

  const save: SaveDraft = (draft, message) => {
    try {
      saveDecision(draft, { id: current.id, submissionId: crypto.randomUUID(), message });
      setPageError("");
      return null;
    } catch (error) {
      if (error instanceof DecisionValidationError) return error.errors;
      return { form: messageOf(error, "The change could not be saved.") } as ErrorMap;
    }
  };

  function quickSave(mutate: (draft: ReturnType<typeof decisionToDraft>) => void, message: string) {
    const draft = decisionToDraft(current);
    mutate(draft);
    const result = save(draft, message);
    if (result) setPageError(Object.values(result).join(" "));
    return result;
  }

  function toggleAction(actionId: string, done: boolean) {
    quickSave((draft) => {
      draft.actions = draft.actions.map((action) => (action.id === actionId ? { ...action, done, completedDate: done ? today : "" } : action));
    }, done ? "Step marked done." : "Step reopened.");
  }

  function linkAction(actionId: string, blockerId: string) {
    quickSave((draft) => {
      draft.actions = draft.actions.map((action) => (action.id === actionId ? { ...action, blockerId } : action));
    }, blockerId ? "Step linked." : "Step unlinked.");
  }

  function setEvidenceStatus(evidenceId: string, status: EvidenceStatus) {
    quickSave((draft) => {
      draft.evidence = draft.evidence.map((item) => (item.id === evidenceId ? { ...item, status } : item));
    }, "Evidence status updated.");
  }

  function acceptSuggestion(suggestion: Suggestion, values: { description: string; owner: string; followUpDate: string }) {
    if (!cleanText(values.description)) return "Write the step before saving it.";
    const result = quickSave((draft) => {
      draft.actions.push(newActionDraft(today, { ...values, blockerId: suggestion.blockerId ?? "", suggestionKey: suggestion.key }));
    }, "Step saved.");
    return result ? Object.values(result).join(" ") : null;
  }

  function dismissSuggestion(suggestion: Suggestion) {
    quickSave((draft) => {
      draft.dismissedSuggestions = [...draft.dismissedSuggestions, suggestion.key];
    }, "Suggestion dismissed.");
  }

  const active = activeBlockers(decision);
  const resolved = Boolean(decision.resolvedDate);
  const openSteps = decision.actions.filter((action) => !action.done);
  const readiness = deriveReadiness(decision);
  const labels = blockerLabels(active);
  const counts: Record<Tab, number | null> = {
    Overview: null,
    Blockers: active.length,
    "Waiting work": decision.blockedWork.length,
    "Next steps": openSteps.length,
    History: null,
  };

  function onTabKey(event: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next]);
    tabRefs.current[next]?.focus();
  }

  function answerQuestion(blockerId: string, key: string, value: string) {
    const result = quickSave((draft) => {
      draft.blockers = draft.blockers.map((blocker) => {
        if (blocker.id !== blockerId) return blocker;
        if (key === "description") return { ...blocker, description: value };
        return { ...blocker, details: { ...blocker.details, [key]: value }, unknowns: blocker.unknowns.filter((item) => item !== key) };
      });
    }, "Saved.");
    return result ? Object.values(result).join(" ") : null;
  }

  function editAction(actionId: string, values: StepValues) {
    if (!cleanText(values.description)) return "Say what needs to happen.";
    const result = quickSave((draft) => {
      draft.actions = draft.actions.map((action) => (action.id === actionId ? { ...action, ...values } : action));
    }, "Step updated.");
    return result ? Object.values(result).join(" ") : null;
  }

  const handlers: GuidanceHandlers = {
    onAnswer: answerQuestion,
    onAccept: acceptSuggestion,
    onDismiss: dismissSuggestion,
    onToggle: toggleAction,
    onEditAction: editAction,
  };

  const best = guidance.best;
  const bestKey = best.kind === "suggestion" ? best.suggestion.key : best.kind === "action" ? `action-${decision.actions[best.index]?.id}` : "none";
  const bestBlockerId = (best.kind === "suggestion" ? best.suggestion.blockerId : best.kind === "action" ? decision.actions[best.index]?.blockerId : null) ?? "";
  const doneSteps = decision.actions.length - openSteps.length;
  const progress = [
    !resolved && active.length ? `${active.length} ${active.length === 1 ? "blocker" : "blockers"}` : null,
    decision.blockedWork.length ? `${decision.blockedWork.length} ${decision.blockedWork.length === 1 ? "work item" : "work items"} waiting` : null,
    doneSteps ? `${doneSteps} ${doneSteps === 1 ? "step" : "steps"} completed` : null,
    openSteps.length ? `${openSteps.length} ${doneSteps ? "remaining" : openSteps.length === 1 ? "open step" : "open steps"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative z-10 grid gap-4 pb-16 xl:pr-24">
      <Link href="/decisions" className="text-sm font-medium text-muted hover:text-ink">
        All decisions
      </Link>
      <article className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{decision.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-3 py-1 font-medium ${resolved || readiness?.state === "ready_to_decide" ? "bg-teal-soft text-ink" : "bg-canvas text-ink"}`}>
                {resolved ? "Resolved" : (readiness?.label ?? STAGE_LABELS[decision.stage])}
              </span>
              {score && score.overdueDays > 0 && !resolved ? (
                <span className="rounded-full bg-[#fff6ee] px-3 py-1 font-medium text-warning-text">Overdue by {score.overdueDays} days</span>
              ) : null}
              {progress ? <span className="text-muted">{progress}</span> : null}
            </div>
          </div>
          <div className="text-right">
            {score?.scored ? (
              <>
                <p className="text-3xl font-semibold tabular-nums">{score.debt}</p>
                <p className="text-xs text-muted">debt score</p>
              </>
            ) : (
              <p className="text-sm text-muted">Not scored</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Add more details
          </Button>
          {resolved ? (
            <Button variant="secondary" onClick={() => setReopening(true)}>
              Reopen
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setResolving(true)}>
              Resolve
            </Button>
          )}
        </div>
      </article>

      {pageError ? (
        <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-danger">
          {pageError}
        </p>
      ) : null}

      <section className="rounded-card border border-line bg-surface shadow-card">
        <div role="tablist" aria-label="Decision sections" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
          {tabs.map((name, index) => (
            <button
              key={name}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${tabIds}-tab-${index}`}
              aria-selected={tab === name}
              aria-controls={`${tabIds}-panel`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-t-xl border-b-2 px-4 text-sm ${
                tab === name ? "border-teal font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {name}
              {counts[name] ? <span className="ml-1.5 rounded-full bg-canvas px-2 text-xs tabular-nums">{counts[name]}</span> : null}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${tabIds}-panel`} aria-labelledby={`${tabIds}-tab-${tabs.indexOf(tab)}`} className="p-4 sm:p-6">
          {tab === "Overview" ? (
            <div className="grid gap-6 text-sm">
              {resolved ? (
                <div className="rounded-2xl bg-teal-soft px-4 py-3">
                  <p className="font-semibold text-ink">Outcome · decided {formatDisplayDate(decision.resolvedDate ?? "")}</p>
                  <p className="mt-1 whitespace-pre-line leading-6 text-ink">{decision.resolutionNote || "No outcome recorded."}</p>
                </div>
              ) : null}

              {!resolved ? (
                <GuidanceCard
                  key={bestKey}
                  heading="Start here"
                  decision={decision}
                  best={guidance.best}
                  onAddInfo={() => setEvidenceTarget({ blockerId: bestBlockerId })}
                  onViewSteps={() => setTab("Next steps")}
                  {...handlers}
                />
              ) : null}

              {readiness ? (
                <Disclosure label={`Why: ${readiness.label}`}>
                  <ul className="grid gap-1 leading-6 text-ink">
                    {readiness.reasons.map((reason) => (
                      <li key={reason} className="break-words">
                        {reason}
                      </li>
                    ))}
                  </ul>
                  {readiness.override ? (
                    <p className="rounded-2xl bg-canvas px-3 py-2 text-muted">
                      <span className="font-medium text-ink">Your note: </span>
                      {readiness.override}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">Worked out from blockers, steps, and evidence. Separate from the debt score.</p>
                  <div className="flex flex-wrap gap-2">
                    {readiness.override ? (
                      <Button variant="ghost" onClick={() => quickSave((draft) => { draft.readinessOverride = ""; }, "Readiness note removed.")}>
                        Remove note
                      </Button>
                    ) : readiness.state !== "ready_to_decide" ? (
                      <Button variant="ghost" onClick={() => setNoting(true)}>
                        Ready anyway? Add a note
                      </Button>
                    ) : null}
                  </div>
                </Disclosure>
              ) : null}

              <Disclosure label="More details">
                {decision.description ? <p className="whitespace-pre-line break-words leading-6 text-muted">{decision.description}</p> : null}
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Item term="Decision owner" value={decision.owner || "Not set"} />
                  <Item term="Department" value={decision.department || "Not set"} />
                  <Item term="Category" value={decision.category || "Not set"} />
                  <Item term="Date identified" value={formatDisplayDate(decision.createdDate)} />
                  <Item term="Target date" value={decision.dueDate ? formatDisplayDate(decision.dueDate) : "None"} />
                  <Item term="Days open" value={score ? String(score.daysOpen) : "Unavailable"} />
                  <Item term="Impact" value={decision.impact === null ? "Not rated" : `${decision.impact} of 5`} />
                  <Item term="Stress" value={decision.stress === null ? "Not rated" : `${decision.stress} of 5`} />
                  <Item term="Urgency" value={decision.urgency ? URGENCY_LABELS[decision.urgency] : "Not set"} />
                  <Item term="If it turns out wrong" value={decision.reversibility ? REVERSIBILITY_LABELS[decision.reversibility] : "Not set"} />
                  <Item term="Rough amount at stake" value={decision.exposure === null ? "Not set" : `${decision.exposure.toLocaleString()} (your estimate)`} />
                </dl>
                <p className="text-muted">
                  {score?.scored
                    ? "The debt score grows the longer a decision stays open, weighted by impact and stress. It isn't a measure of importance."
                    : "No debt score yet. Rate impact and stress under Add more details to see one."}
                </p>
              </Disclosure>
            </div>
          ) : null}

          {tab === "Blockers" ? (
            <div className="grid gap-5 text-sm">
              {active.length === 0 ? (
                <p className="text-muted">{resolved ? "Nothing was blocking this decision when it was resolved." : "Nothing is blocking this decision right now."}</p>
              ) : (
                active.map((blocker) => (
                  <BlockerWorkspace
                    key={blocker.id}
                    decision={decision}
                    blocker={blocker}
                    label={labels.get(blocker.id) ?? blockerGuide(blocker.type).label}
                    decisions={decisions}
                    suggestion={guidance.result.suggestions.find((item) => item.blockerId === blocker.id) ?? null}
                    gap={guidance.result.gaps.find((item) => item.blockerId === blocker.id)?.message ?? null}
                    handlers={handlers}
                    onAddStep={(values) => {
                      const result = quickSave((draft) => {
                        draft.actions.push(newActionDraft(today, { ...values, blockerId: blocker.id }));
                      }, "Step saved.");
                      return result ? Object.values(result).join(" ") : null;
                    }}
                    onAddEvidence={() => setEvidenceTarget({ blockerId: blocker.id })}
                    onEditEvidence={(evidenceId) => setEvidenceTarget({ evidenceId, blockerId: blocker.id })}
                    onEvidenceStatus={setEvidenceStatus}
                    onClear={() => setClearing(blocker.id)}
                  />
                ))
              )}

              <ClearedBlockers decision={decision} />

              <UnlinkedEvidence
                decision={decision}
                onEdit={(evidenceId) => setEvidenceTarget({ evidenceId, blockerId: "" })}
                onStatus={setEvidenceStatus}
              />

              {!resolved ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Add or change blockers
                  </Button>
                  <Button variant="ghost" onClick={() => setEvidenceTarget({ blockerId: "" })}>
                    Add supporting information
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "Waiting work" ? (
            <div className="grid gap-4 text-sm">
              {decision.blockedWork.length === 0 ? (
                <p className="text-muted">No waiting work has been listed.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {decision.blockedWork.map((item) => (
                    <li key={item.id} className="rounded-full bg-canvas px-4 py-2">
                      {item.title}
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="secondary" className="justify-self-start" onClick={() => setEditing(true)}>
                Edit waiting work
              </Button>
            </div>
          ) : null}

          {tab === "Next steps" ? (
            <StepsPanel
              decision={decision}
              onToggle={toggleAction}
              onLink={linkAction}
              onAdd={(values) => {
                const result = quickSave((draft) => {
                  draft.actions.push(newActionDraft(today, values));
                }, "Step saved.");
                return result ? Object.values(result).join(" ") : null;
              }}
            />
          ) : null}

          {tab === "History" ? <HistoryPanel decision={decision} /> : null}
        </div>
      </section>

      {editing ? <DecisionWizard open decision={decision} onClose={() => setEditing(false)} /> : null}
      {resolving ? <ResolveDialog decision={decision} onClose={() => setResolving(false)} resolve={resolveDecision} /> : null}
      {reopening ? <ReopenDialog decision={decision} onClose={() => setReopening(false)} reopen={reopenDecision} /> : null}
      {clearing ? <ClearBlockerDialog decision={decision} blockerId={clearing} onClose={() => setClearing(null)} save={save} /> : null}
      {evidenceTarget ? (
        <EvidenceDialog
          decision={decision}
          evidenceId={evidenceTarget.evidenceId}
          defaultBlockerId={evidenceTarget.blockerId}
          onClose={() => setEvidenceTarget(null)}
          save={save}
        />
      ) : null}
      {noting ? <ReadinessDialog decision={decision} onClose={() => setNoting(false)} save={save} /> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function BlockerWorkspace({
  decision,
  blocker,
  label,
  decisions,
  suggestion,
  gap,
  handlers,
  onAddStep,
  onAddEvidence,
  onEditEvidence,
  onEvidenceStatus,
  onClear,
}: {
  decision: Decision;
  blocker: Blocker;
  label: string;
  decisions: Decision[];
  suggestion: Suggestion | null;
  gap: string | null;
  handlers: GuidanceHandlers;
  onAddStep: (values: { description: string; owner: string; followUpDate: string }) => string | null;
  onAddEvidence: () => void;
  onEditEvidence: (evidenceId: string) => void;
  onEvidenceStatus: (evidenceId: string, status: EvidenceStatus) => void;
  onClear: () => void;
}) {
  const guide = blockerGuide(blocker.type);
  const steps = actionsFor(decision, blocker.id);
  const evidence = evidenceFor(decision, blocker.id);
  const upstream = blocker.dependsOnDecisionId ? decisions.find((item) => item.id === blocker.dependsOnDecisionId) : undefined;
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const openStep = steps.find((action) => !action.done);
  const stepSummary = openStep
    ? `Step: ${openStep.description}`
    : steps.length
      ? `${steps.length} ${steps.length === 1 ? "step" : "steps"} done`
      : "No step yet";
  const onToggle = handlers.onToggle;

  return (
    <section aria-label={label} className="grid gap-4 rounded-2xl border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{label}</p>
          <p className={`truncate ${blocker.description ? "text-ink" : "text-muted"}`} title={blocker.description || undefined}>
            {blocker.description || "Not described yet"}
          </p>
          <p className="truncate text-xs text-muted">
            {stepSummary}
            {evidence.length ? ` · ${evidence.length} supporting ${evidence.length === 1 ? "note" : "notes"}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-[#fff6ee] px-3 py-1 text-xs font-medium text-warning-text">Active</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Hide details" : "Work on it"}
        </Button>
        <Button variant="ghost" onClick={onClear}>
          Clear blocker…
        </Button>
      </div>

      {expanded ? (
      <div id={panelId} className="grid gap-4 border-t border-line pt-4">
      {suggestion ? <GuidanceCard key={suggestion.key} compact decision={decision} best={{ kind: "suggestion", suggestion }} {...handlers} /> : null}
      {!suggestion && gap ? <p className="text-muted">{gap}</p> : null}

      <Section title="What's blocking progress">
        <p className={`whitespace-pre-line break-words leading-6 ${blocker.description ? "text-ink" : "text-muted"}`}>{blocker.description || "Not described yet."}</p>
        <p className="text-xs text-muted">Noticed {formatDisplayDate(blocker.identifiedDate)}</p>
        {guide.followUps.some((question) => blocker.details[question.key] || blocker.unknowns.includes(question.key)) ? (
          <dl className="grid gap-2">
            {guide.followUps.map((question) =>
              blocker.details[question.key] || blocker.unknowns.includes(question.key) ? (
                <div key={question.key}>
                  <dt className="text-muted">{question.label}</dt>
                  <dd className="break-words font-medium text-ink">
                    {blocker.unknowns.includes(question.key)
                      ? "Not known yet"
                      : question.kind === "date"
                        ? formatDisplayDate(blocker.details[question.key])
                        : blocker.details[question.key]}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : null}
        {blocker.dependsOnDecisionId ? (
          upstream ? (
            <p>
              Waits on{" "}
              <Link href={`/decisions/${upstream.id}`} className="font-medium text-teal underline-offset-2 hover:underline">
                {upstream.title}
              </Link>{" "}
              <span className="text-muted">({upstream.resolvedDate ? "resolved" : STAGE_LABELS[upstream.stage].toLowerCase()})</span>
            </p>
          ) : (
            <p className="text-muted">The linked decision is no longer in this browser.</p>
          )
        ) : null}
      </Section>

      <Section title="Who can help">
        <p className="text-ink">
          {blocker.owner || "No one named yet"}
          {blocker.followUpDate ? <span className="text-muted"> · follow up {formatDisplayDate(blocker.followUpDate)}</span> : null}
        </p>
      </Section>

      <Section title="What would clear it">
        <p className={`whitespace-pre-line break-words leading-6 ${blocker.resolvesWhen ? "text-ink" : "text-muted"}`}>
          {blocker.resolvesWhen || "Not written down yet. Add it under Add more details."}
        </p>
      </Section>

      <Section title="Steps for this blocker">
        {steps.length === 0 ? <p className="text-muted">No steps linked yet.</p> : <StepList steps={steps} onToggle={onToggle} />}
        {adding ? (
          <InlineStepForm
            idPrefix={`step-${blocker.id.slice(0, 8)}`}
            onCancel={() => setAdding(false)}
            onSave={(values) => {
              const error = onAddStep(values);
              if (!error) setAdding(false);
              return error;
            }}
          />
        ) : (
          <Button variant="ghost" className="justify-self-start" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Write a step
          </Button>
        )}
      </Section>

      <Section title="Supporting information">
        {evidence.length === 0 ? (
          <p className="text-muted">Optional. Nothing recorded.</p>
        ) : (
          <ul className="grid gap-2">
            {evidence.map((item) => (
              <EvidenceItem key={item.id} item={item} onEdit={() => onEditEvidence(item.id)} onStatus={(status) => onEvidenceStatus(item.id, status)} />
            ))}
          </ul>
        )}
        <Button variant="ghost" className="justify-self-start" onClick={onAddEvidence}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add supporting information
        </Button>
      </Section>
      </div>
      ) : null}
    </section>
  );
}

function ClearedBlockers({ decision }: { decision: Decision }) {
  const cleared = decision.blockers.filter((blocker) => blocker.status === "resolved");
  if (cleared.length === 0) return null;
  const how = { criteria_met: "Criteria met", not_applicable: "Criteria didn't apply", override: "Cleared before criteria were met" } as const;
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold text-ink">Cleared</h3>
      <ul className="grid gap-2">
        {cleared.map((blocker) => {
          const steps = actionsFor(decision, blocker.id).length;
          const evidence = evidenceFor(decision, blocker.id).length;
          return (
            <li key={blocker.id} className="rounded-2xl bg-canvas px-4 py-3">
              <span className="font-medium">{blockerGuide(blocker.type).label}:</span> <span className="break-words">{blocker.description || "No description"}</span>
              <span className="block text-muted">
                Noticed {formatDisplayDate(blocker.identifiedDate)}
                {blocker.resolvedDate ? ` · cleared ${formatDisplayDate(blocker.resolvedDate)}` : ""}
                {blocker.clearedHow ? ` · ${how[blocker.clearedHow]}` : ""}
                {steps || evidence ? ` · ${steps} steps, ${evidence} evidence` : ""}
              </span>
              {blocker.resolutionNote ? <span className="mt-1 block break-words text-ink">{blocker.resolutionNote}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function UnlinkedEvidence({
  decision,
  onEdit,
  onStatus,
}: {
  decision: Decision;
  onEdit: (evidenceId: string) => void;
  onStatus: (evidenceId: string, status: EvidenceStatus) => void;
}) {
  const items = decision.evidence.filter((item) => !item.blockerId);
  if (items.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold text-ink">Evidence not linked to a blocker</h3>
      <ul className="grid gap-2">
        {items.map((item) => (
          <EvidenceItem key={item.id} item={item} onEdit={() => onEdit(item.id)} onStatus={(status) => onStatus(item.id, status)} />
        ))}
      </ul>
    </section>
  );
}

function StepList({ steps, onToggle }: { steps: NextAction[]; onToggle: (id: string, done: boolean) => void }) {
  const today = localTodayISO();
  return (
    <ul className="grid gap-2">
      {steps.map((action) => {
        const late = !action.done && action.followUpDate && compareISODate(action.followUpDate, today) === -1;
        return (
          <li key={action.id} className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={action.done}
              aria-label={`Mark "${action.description}" as ${action.done ? "not done" : "done"}`}
              onChange={(event) => onToggle(action.id, event.target.checked)}
            />
            <span className="min-w-0">
              <span className={`break-words ${action.done ? "text-muted line-through" : "font-medium text-ink"}`}>{action.description}</span>
              <span className="block text-muted">
                {action.owner || "No one named"}
                {action.followUpDate ? ` · follow up ${formatDisplayDate(action.followUpDate)}` : ""}
                {action.done && action.completedDate ? ` · done ${formatDisplayDate(action.completedDate)}` : ""}
                {late ? <span className="text-warning-text"> · follow-up date has passed</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function InlineStepForm({
  idPrefix,
  onSave,
  onCancel,
  blockers,
}: {
  idPrefix: string;
  onSave: (values: { description: string; owner: string; followUpDate: string; blockerId: string }) => string | null;
  onCancel: () => void;
  blockers?: Blocker[];
}) {
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [blockerId, setBlockerId] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="grid gap-3 rounded-2xl bg-canvas p-4">
      <Field id={`${idPrefix}-text`} label="Step" required error={error || undefined}>
        <input id={`${idPrefix}-text`} className={controlClass} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <div className={`grid gap-3 ${blockers ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {blockers ? (
          <Field id={`${idPrefix}-blocker`} label="Addresses">
            <select id={`${idPrefix}-blocker`} className={controlClass} value={blockerId} onChange={(event) => setBlockerId(event.target.value)}>
              <option value="">No specific blocker</option>
              {blockers.map((blocker) => (
                <option key={blocker.id} value={blocker.id}>
                  {blockerGuide(blocker.type).label}: {blocker.description.slice(0, 50)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field id={`${idPrefix}-owner`} label="Who" hint="Optional.">
          <input id={`${idPrefix}-owner`} className={controlClass} value={owner} onChange={(event) => setOwner(event.target.value)} />
        </Field>
        <Field id={`${idPrefix}-date`} label="Follow up on" hint="Optional.">
          <input id={`${idPrefix}-date`} type="date" className={controlClass} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            const result = onSave({ description, owner, followUpDate, blockerId });
            if (result) setError(result);
          }}
        >
          Save step
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function StepsPanel({
  decision,
  onToggle,
  onLink,
  onAdd,
}: {
  decision: Decision;
  onToggle: (id: string, done: boolean) => void;
  onLink: (actionId: string, blockerId: string) => void;
  onAdd: (values: { description: string; owner: string; followUpDate: string; blockerId: string }) => string | null;
}) {
  const [adding, setAdding] = useState(false);
  const active = activeBlockers(decision);
  const open = decision.actions.filter((action) => !action.done);
  const done = decision.actions.filter((action) => action.done);
  const today = localTodayISO();

  function row(action: NextAction) {
    const blocker = decision.blockers.find((item) => item.id === action.blockerId);
    const late = !action.done && action.followUpDate && compareISODate(action.followUpDate, today) === -1;
    const choices = blocker && blocker.status === "resolved" ? [...active, blocker] : active;
    return (
      <li key={action.id} className="grid gap-2 rounded-2xl border border-line px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={action.done}
            aria-label={`Mark "${action.description}" as ${action.done ? "not done" : "done"}`}
            onChange={(event) => onToggle(action.id, event.target.checked)}
          />
          <span className="min-w-0">
            <span className={`break-words ${action.done ? "text-muted line-through" : "font-medium text-ink"}`}>{action.description}</span>
            <span className="block text-muted">
              {action.owner || "No one named"}
              {action.followUpDate ? ` · follow up ${formatDisplayDate(action.followUpDate)}` : ""}
              {action.done && action.completedDate ? ` · done ${formatDisplayDate(action.completedDate)}` : ""}
              {late ? <span className="text-warning-text"> · follow-up date has passed</span> : null}
            </span>
          </span>
        </div>
        <label className="grid gap-1 text-xs text-muted sm:w-56">
          Addresses
          <select className={`${controlClass} py-2`} value={action.blockerId ?? ""} onChange={(event) => onLink(action.id, event.target.value)}>
            <option value="">No specific blocker</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {blockerGuide(item.type).label}: {item.description.slice(0, 40)}
                {item.status === "resolved" ? " (cleared)" : ""}
              </option>
            ))}
          </select>
        </label>
      </li>
    );
  }

  return (
    <div className="grid gap-4 text-sm">
      {decision.actions.length === 0 ? <p className="text-muted">No next steps yet. Decisions tend to stall without one.</p> : null}
      {open.length > 0 ? <ul className="grid gap-2">{open.map(row)}</ul> : null}
      {adding ? (
        <InlineStepForm
          idPrefix="new-step"
          blockers={active}
          onCancel={() => setAdding(false)}
          onSave={(values) => {
            const error = onAdd(values);
            if (!error) setAdding(false);
            return error;
          }}
        />
      ) : !decision.resolvedDate ? (
        <Button variant="secondary" className="justify-self-start" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a step
        </Button>
      ) : null}
      {done.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="font-semibold text-ink">Completed</h3>
          <ul className="grid gap-2">{done.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function HistoryPanel({ decision }: { decision: Decision }) {
  return (
    <div className="text-sm">
      <p className="text-muted">Changes recorded in this browser. This is a simple activity history, not a tamper-proof audit log.</p>
      {decision.events.length === 0 ? (
        <p className="mt-4 text-muted">No history has been recorded for this decision yet.</p>
      ) : (
        <ol className="mt-4 grid gap-2">
          {[...decision.events].reverse().map((event, index) => (
            <li key={`${event.type}-${event.at}-${index}`} className="rounded-2xl bg-canvas px-4 py-3">
              <span className="font-medium">{EVENT_LABELS[event.type]}</span>
              <span className="text-muted"> · {formatEventTime(event.at)}</span>
              {event.note ? <span className="mt-1 block break-words">{event.note}</span> : null}
              {event.detail ? <span className="mt-1 block break-words text-muted">{event.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ResolveDialog({
  decision,
  onClose,
  resolve,
}: {
  decision: Decision;
  onClose: () => void;
  resolve: ReturnType<typeof useAppState>["resolveDecision"];
}) {
  const [submissionId] = useState(() => crypto.randomUUID());
  const [resolvedDate, setResolvedDate] = useState(localTodayISO());
  const [outcome, setOutcome] = useState("");
  const [closeBlockers, setCloseBlockers] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = activeBlockers(decision);

  function submit() {
    if (saving) return;
    if (active.length > 0 && !closeBlockers) {
      setError("Confirm that the active blockers can be closed, or clear them first.");
      return;
    }
    setSaving(true);
    try {
      resolve(decision.id, { resolvedDate, outcome, closeBlockers }, submissionId);
      onClose();
    } catch (caught) {
      setSaving(false);
      setError(messageOf(caught, "The decision could not be resolved."));
    }
  }

  return (
    <Dialog open title="Resolve this decision" description="Record when it was decided and what was decided." onClose={onClose}>
      <div className="grid gap-4">
        <Field id="resolve-date" label="Decided on" required>
          <input
            id="resolve-date"
            type="date"
            className={controlClass}
            max={localTodayISO()}
            min={decision.createdDate}
            value={resolvedDate}
            onChange={(event) => setResolvedDate(event.target.value)}
          />
        </Field>
        <Field id="resolve-note" label="What was decided" required>
          <textarea id="resolve-note" className={`${controlClass} min-h-20`} value={outcome} onChange={(event) => setOutcome(event.target.value)} />
        </Field>
        {active.length > 0 ? (
          <div className="rounded-2xl bg-[#fff6ee] px-4 py-3 text-sm text-warning-text">
            <p className="font-medium">
              {active.length} {active.length === 1 ? "blocker is" : "blockers are"} still active:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {active.map((blocker) => (
                <li key={blocker.id} className="break-words">
                  {blocker.description || blockerGuide(blocker.type).label}
                </li>
              ))}
            </ul>
            <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-ink">
              <input type="checkbox" checked={closeBlockers} onChange={(event) => setCloseBlockers(event.target.checked)} />
              Close {active.length === 1 ? "it" : "them"} as part of this decision (recorded as cleared before the criteria were met)
            </label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Resolve decision"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReopenDialog({
  decision,
  onClose,
  reopen,
}: {
  decision: Decision;
  onClose: () => void;
  reopen: ReturnType<typeof useAppState>["reopenDecision"];
}) {
  const [submissionId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function submit() {
    if (saving) return;
    setSaving(true);
    try {
      reopen(decision.id, reason, submissionId);
      onClose();
    } catch (caught) {
      setSaving(false);
      setError(messageOf(caught, "The decision could not be reopened."));
    }
  }

  return (
    <Dialog
      open
      title="Reopen this decision?"
      description="The current outcome stays in the history. The decision will count toward open debt again."
      onClose={onClose}
    >
      <Field id="reopen-reason" label="Why is it being reopened?" required error={error || undefined}>
        <textarea id="reopen-reason" className={`${controlClass} min-h-20`} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Reopen"}
        </Button>
      </div>
    </Dialog>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{term}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}
