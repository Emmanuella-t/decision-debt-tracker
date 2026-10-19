import { DISPLAY_NAME_MAX, PREFERENCES_STORAGE_KEY } from "./constants";

export type Preferences = {
  displayName: string;
};

type MemoryStorage = Pick<Storage, "getItem" | "setItem">;

function storageOrNull(storage?: MemoryStorage): MemoryStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function emptyPreferences(): Preferences {
  return { displayName: "" };
}

export function loadPreferences(storage?: MemoryStorage): Preferences {
  const target = storageOrNull(storage);
  if (!target) return emptyPreferences();
  const raw = target.getItem(PREFERENCES_STORAGE_KEY);
  if (!raw) return emptyPreferences();
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      displayName: typeof parsed.displayName === "string" ? parsed.displayName.slice(0, DISPLAY_NAME_MAX) : "",
    };
  } catch {
    return emptyPreferences();
  }
}

export function savePreferences(preferences: Preferences, storage?: MemoryStorage) {
  const target = storageOrNull(storage);
  if (!target) return;
  target.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function validateDisplayName(value: string): string | null {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (cleaned.length > DISPLAY_NAME_MAX) {
    return `Use a name of ${DISPLAY_NAME_MAX} characters or fewer.`;
  }
  return null;
}

export function cleanDisplayName(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, DISPLAY_NAME_MAX);
}
