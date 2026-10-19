"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { summarize, upsertSnapshot } from "../../lib/analytics";
import {
  acceptSubmission,
  commitDecision,
  loadDecisionStore,
  loadSnapshots,
  reopenDecision,
  resolutionDraft,
  saveDecisions,
  saveSnapshots,
} from "../../lib/data/decisions";
import { localTodayISO } from "../../lib/dates";
import {
  cleanDisplayName,
  loadPreferences,
  savePreferences,
  validateDisplayName,
  type Preferences,
} from "../../lib/preferences";
import type { Decision, DecisionDraft, Snapshot } from "../../lib/types";
import { DecisionValidationError } from "../../lib/validation";

type ResolveInput = { resolvedDate: string; outcome: string; closeBlockers: boolean };

type AppStateValue = {
  ready: boolean;
  decisions: Decision[];
  snapshots: Snapshot[];
  preferences: Preferences;
  notice: string | null;
  dismissNotice: () => void;
  saveDecision: (draft: DecisionDraft, options: { id?: string; submissionId: string; message?: string }) => Decision;
  resolveDecision: (id: string, input: ResolveInput, submissionId: string) => Decision;
  reopenDecision: (id: string, reason: string, submissionId: string) => Decision;
  setDisplayName: (name: string) => string | null;
};

const AppStateContext = createContext<AppStateValue | null>(null);

function loadNotice(result: ReturnType<typeof loadDecisionStore>): string | null {
  if (result.storeUnreadable) {
    return "Saved decisions in this browser could not be read. A copy was kept aside and nothing was deleted.";
  }
  const parts: string[] = [];
  if (result.migratedFrom) parts.push("Your decisions were upgraded to the new format. The previous copy is still kept in this browser.");
  if (result.quarantined > 0) {
    parts.push(
      `${result.quarantined} saved ${result.quarantined === 1 ? "entry" : "entries"} could not be fully read and ${result.quarantined === 1 ? "was" : "were"} kept aside unchanged.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ displayName: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const submissions = useRef(new Set<string>());

  useEffect(() => {
    // Browser storage is only readable after hydration.
    const handle = window.setTimeout(() => {
      const result = loadDecisionStore();
      setDecisions(result.decisions);
      setSnapshots(loadSnapshots());
      setPreferences(loadPreferences());
      setNotice(loadNotice(result));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const today = localTodayISO();
    const summary = summarize(decisions, new Date());
    setSnapshots((current) => {
      const next = upsertSnapshot(current, {
        date: today,
        totalDebt: summary.totalDebt,
        openCount: summary.openCount,
        overdueCount: summary.overdueCount,
      });
      const unchanged =
        next.length === current.length &&
        next.every(
          (snapshot, index) =>
            snapshot.date === current[index]?.date &&
            snapshot.totalDebt === current[index]?.totalDebt &&
            snapshot.openCount === current[index]?.openCount &&
            snapshot.overdueCount === current[index]?.overdueCount,
        );
      if (unchanged) return current;
      saveSnapshots(next);
      return next;
    });
  }, [decisions, ready]);

  const value = useMemo<AppStateValue>(() => {
    function guarded(submissionId: string, run: () => { next: Decision[]; saved: Decision; message: string }) {
      if (!acceptSubmission(submissions.current, submissionId)) {
        throw new Error("This change was already saved.");
      }
      try {
        const { next, saved, message } = run();
        try {
          saveDecisions(next);
        } catch {
          throw new Error("The change could not be stored in this browser. Storage may be full or blocked.");
        }
        setDecisions(next);
        setNotice(message);
        return saved;
      } catch (error) {
        submissions.current.delete(submissionId);
        throw error;
      }
    }

    function find(list: Decision[], id: string) {
      const found = list.find((item) => item.id === id);
      if (!found) throw new DecisionValidationError({ title: "The decision could not be saved." });
      return found;
    }

    return {
      ready,
      decisions,
      snapshots,
      preferences,
      notice,
      dismissNotice: () => setNotice(null),
      saveDecision: (draft, options) =>
        guarded(options.submissionId, () => {
          const next = commitDecision(decisions, draft, { today: localTodayISO(), id: options.id });
          const saved = options.id ? find(next, options.id) : next[0];
          return { next, saved, message: options.message ?? (options.id ? "Decision updated." : "Decision saved.") };
        }),
      resolveDecision: (id, input, submissionId) =>
        guarded(submissionId, () => {
          const draft = resolutionDraft(find(decisions, id), input);
          const next = commitDecision(decisions, draft, { today: localTodayISO(), id });
          return { next, saved: find(next, id), message: "Decision resolved." };
        }),
      reopenDecision: (id, reason, submissionId) =>
        guarded(submissionId, () => {
          const next = reopenDecision(decisions, id, reason, localTodayISO());
          return { next, saved: find(next, id), message: "Decision reopened." };
        }),
      setDisplayName: (name) => {
        const error = validateDisplayName(name);
        if (error) return error;
        const next = { displayName: cleanDisplayName(name) };
        setPreferences(next);
        savePreferences(next);
        setNotice(next.displayName ? "Display name saved on this device." : "Display name cleared.");
        return null;
      },
    };
  }, [decisions, notice, preferences, ready, snapshots]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
