/**
 * Documented limits. They exist to keep records readable and to reject
 * values the scoring model cannot interpret. They are not business targets.
 */
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2_000;
export const CATEGORY_MAX = 40;
export const RESOLUTION_NOTE_MAX = 500;
export const DISPLAY_NAME_MAX = 40;
export const OWNER_MAX = 60;
export const BLOCKER_TEXT_MAX = 500;
export const WORK_ITEM_MAX = 120;
export const ACTION_MAX = 300;
export const REOPEN_REASON_MAX = 300;
export const MAX_BLOCKERS = 10;
export const MAX_WORK_ITEMS = 20;
export const MAX_ACTIONS = 30;
export const MAX_EVIDENCE = 50;
export const EVIDENCE_TITLE_MAX = 120;
export const EVIDENCE_TEXT_MAX = 2_000;
export const SOURCE_NAME_MAX = 200;
export const URL_MAX = 2_000;
export const MAX_DISMISSED = 200;
/** Rejects values that are almost certainly typos rather than estimates. */
export const EXPOSURE_MAX = 1_000_000_000_000;

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Open longer than this produces an advisory warning, not a block. */
export const LONG_OPEN_DAYS = 90;

/**
 * Departments the web app can store. The Python CLI database does not have
 * this column yet, so department lives only in browser storage.
 */
export const DEPARTMENTS = ["Product", "Engineering", "Marketing", "Operations"] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_COLORS: Record<string, string> = {
  Product: "#142A32",
  Engineering: "#177C72",
  Marketing: "#7EAEA8",
  Operations: "#D98B42",
  "Not assigned": "#C5D0D4",
};

/** Legacy flat array. Read once for migration and never written again. */
export const LEGACY_DECISIONS_STORAGE_KEY = "ddt.decisions.v1";
/** Milestone A store. Read once for migration and never written again. */
export const V2_DECISIONS_STORAGE_KEY = "ddt.decisions.v2";
export const DECISIONS_STORAGE_KEY = "ddt.decisions.v3";
/** Raw entries that could not be read. Kept so nothing is silently discarded. */
export const QUARANTINE_STORAGE_KEY = "ddt.decisions.quarantine";
export const SNAPSHOTS_STORAGE_KEY = "ddt.snapshots.v1";
export const PREFERENCES_STORAGE_KEY = "ddt.preferences.v1";
