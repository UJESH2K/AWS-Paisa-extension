import type { Entity } from "./convert";

export interface Settings {
  entity: Entity;
  markupPct: number; // fraction
  gstPct: number; // fraction
}

export const DEFAULT_SETTINGS: Settings = { entity: "AWS_INC", markupPct: 0.035, gstPct: 0.18 };

/**
 * GET /spend response. The backend (spend_handler.py) computes the INR
 * breakdown with its own settings; the dashboard only relies on the raw inputs
 * (usd, fx, services, days) so it can recompute when the user edits settings.
 */
export interface SpendResponse {
  month: string; // "YYYY-MM"
  usd: number;
  fx: { rate: number; fetchedAt: string };
  breakdown: { base: number; markup: number; gst: number; total: number };
  projection: number;
  services: { name: string; usd: number; inr: number }[]; // top 5 by spend
  daysElapsed: number;
  daysInMonth: number;
  settings: { entity: Entity; markup_pct: number; gst_pct: number };
  cachedAt?: string; // when Cost Explorer was last actually queried
}

export interface RegisterResponse {
  token: string;
  externalId: string;
}
