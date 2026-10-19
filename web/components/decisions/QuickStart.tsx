"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { QUICK_START_CHOICES } from "../../lib/blockers";
import { TITLE_MAX } from "../../lib/constants";
import { localTodayISO } from "../../lib/dates";
import { draftFromQuickStart, quickStartErrors } from "../../lib/quickstart";
import type { DecisionDraft } from "../../lib/types";
import { DecisionValidationError } from "../../lib/validation";
import { useAppState } from "../providers/AppState";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { controlClass } from "../ui/Field";
import { DecisionWizard } from "./DecisionWizard";

export function QuickStart({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { saveDecision } = useAppState();
  const ids = useId();
  const [submissionId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("");
  const [errors, setErrors] = useState<{ title?: string; choice?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState<DecisionDraft | null>(null);

  function draftFromAnswers(): DecisionDraft {
    return draftFromQuickStart(title, choice, localTodayISO());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found = quickStartErrors(title, choice);
    setErrors(found);
    if (found.title || found.choice) return;
    setSaving(true);
    try {
      const saved = saveDecision(draftFromAnswers(), { submissionId, message: "Decision saved." });
      onClose();
      router.push(`/decisions/${saved.id}`);
    } catch (error) {
      setSaving(false);
      const message = error instanceof DecisionValidationError ? Object.values(error.errors).join(" ") : error instanceof Error ? error.message : "The decision could not be saved.";
      setErrors({ form: message });
    }
  }

  if (advanced) return <DecisionWizard open initialDraft={advanced} onClose={onClose} />;

  return (
    <Dialog open title="New decision" onClose={onClose}>
      <form className="grid gap-6" onSubmit={submit} noValidate>
        <div className="grid gap-2">
          <label htmlFor={`${ids}-title`} className="text-base font-semibold text-ink">
            What are you trying to decide?
          </label>
          <textarea
            id={`${ids}-title`}
            className={`${controlClass} min-h-24 text-base`}
            placeholder="Should we launch our product in November or January?"
            value={title}
            maxLength={TITLE_MAX + 50}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? `${ids}-title-error` : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
          />
          {errors.title ? (
            <p id={`${ids}-title-error`} role="alert" className="text-sm text-danger">
              {errors.title}
            </p>
          ) : null}
        </div>

        <fieldset className="grid gap-2" aria-describedby={errors.choice ? `${ids}-choice-error` : undefined}>
          <legend className="mb-2 text-base font-semibold text-ink">What&apos;s holding you up?</legend>
          {QUICK_START_CHOICES.map((item) => (
            <label
              key={item.value}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm ${choice === item.value ? "border-teal bg-teal-soft" : "border-line hover:bg-canvas"}`}
            >
              <input
                type="radio"
                name={`${ids}-choice`}
                value={item.value}
                checked={choice === item.value}
                onChange={() => {
                  setChoice(item.value);
                  setErrors((current) => ({ ...current, choice: undefined }));
                }}
              />
              <span className="text-ink">{item.label}</span>
            </label>
          ))}
          {errors.choice ? (
            <p id={`${ids}-choice-error`} role="alert" className="text-sm text-danger">
              {errors.choice}
            </p>
          ) : null}
        </fieldset>

        {errors.form ? (
          <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-danger">
            {errors.form}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setAdvanced(draftFromAnswers())}>
            Add more details
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Help me move forward"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
