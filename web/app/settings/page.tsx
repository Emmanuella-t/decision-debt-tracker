"use client";

import { useState } from "react";
import { DISPLAY_NAME_MAX } from "../../lib/constants";
import { useAppState } from "../../components/providers/AppState";
import { Button } from "../../components/ui/Button";

export default function SettingsPage() {
  const { ready, preferences, setDisplayName } = useAppState();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = name ?? preferences.displayName;

  if (!ready) return <p className="text-sm text-muted">Loading settings…</p>;

  return (
    <div className="relative z-10 grid max-w-3xl gap-4 pb-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          There is no account. The name below is only a label for this browser.
        </p>
      </header>

      <form
        className="rounded-card border border-line bg-surface p-6 shadow-card"
        onSubmit={(event) => {
          event.preventDefault();
          const nextError = setDisplayName(value);
          setError(nextError);
          if (!nextError) setName(null);
        }}
      >
        <label htmlFor="display-name" className="text-sm font-medium">
          Display name
        </label>
        <p id="display-name-hint" className="mt-1 text-sm text-muted">
          Shown in the greeting. Leave it blank to use “there”. Up to {DISPLAY_NAME_MAX} characters.
        </p>
        <input
          id="display-name"
          value={value}
          maxLength={DISPLAY_NAME_MAX}
          aria-describedby="display-name-hint"
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className="mt-3 w-full rounded-2xl border border-line px-4 py-3"
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button className="mt-4" type="submit">
          Save name
        </Button>
      </form>

      <section className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold">Where data lives</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Decisions, blockers, waiting work, next steps, evidence notes, daily snapshots, and this display name are stored in this browser&apos;s local storage only. They are not sent anywhere, other people can&apos;t see them, and clearing site data in this browser erases them. They are separate from the command-line SQLite database.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Decisions saved by earlier versions are upgraded to the current format the first time this version opens. The earlier copies are left untouched. Any saved entry that couldn&apos;t be read is kept aside unchanged instead of being deleted.
        </p>
      </section>

      <section className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold">Two scoring formulas</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          The web app still uses its existing curve: time open and overdue time are blended, then multiplied by separate impact and stress factors, and capped at 100. Health uses a divisor of 160. The command-line app multiplies time growth by combined severity and a smaller overdue boost, and its health divisor is 200. Neither formula was changed in this release. Impact and stress are optional: a decision without both isn&apos;t scored and isn&apos;t counted in the debt total, though it still counts as open. A later milestone should adopt the command-line formula everywhere and show the difference before any saved score changes.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Day counts now use calendar dates, so a daylight-saving change cannot drop a day. That can shift a score by one day of the same curve around those dates.
        </p>
      </section>

      <section className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold">Not in this version</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>Sign-in, sharing, assignment, and notifications. Owner names are labels only, and nobody is contacted.</li>
          <li>Checking evidence. Links and sources are recorded as you enter them and are never opened or verified by the app. &ldquo;Reviewed&rdquo; only means you marked it reviewed.</li>
          <li>File uploads, comparing options, and bottleneck insights. These are planned for later milestones.</li>
          <li>AI suggestions. Suggested steps come from fixed rules based on what you entered, and nothing is saved until you confirm it.</li>
          <li>Blockers, evidence, readiness, urgency, reversibility, and the amount at stake do not change the debt score.</li>
          <li>Department, blockers, and next steps on the command-line database. They are stored in this browser only.</li>
          <li>A permanent audit log. History is kept with each decision in this browser only.</li>
          <li>Deleting or archiving a decision. Resolve and reopen are the supported lifecycle actions.</li>
          <li>Month-over-month percentages until a snapshot from about 30 days earlier exists.</li>
        </ul>
      </section>
    </div>
  );
}
