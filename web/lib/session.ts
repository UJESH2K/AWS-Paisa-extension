// Browser-side persistence. The token is our own per-user API token (never an
// AWS credential). Every access is wrapped: storage can be blocked or empty.
import { DEFAULT_SETTINGS, type Settings } from "./types";

const SESSION_KEY = "paisa.session";
const SETTINGS_KEY = "paisa.settings";

export interface Session {
  token: string;
  externalId: string;
  roleArn?: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export const loadSession = () => read<Session>(SESSION_KEY);
export const saveSession = (s: Session) => write(SESSION_KEY, s);
export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings | null {
  const s = read<Partial<Settings>>(SETTINGS_KEY);
  if (!s) return null;
  return {
    entity: s.entity === "AISPL" ? "AISPL" : DEFAULT_SETTINGS.entity,
    markupPct: typeof s.markupPct === "number" ? s.markupPct : DEFAULT_SETTINGS.markupPct,
    gstPct: typeof s.gstPct === "number" ? s.gstPct : DEFAULT_SETTINGS.gstPct,
  };
}
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);
