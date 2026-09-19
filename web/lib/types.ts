import type { Entity } from "./convert";

/** Client-side view of the user's assumptions (fractions, camelCase). */
export interface Settings {
  entity: Entity;
  markupPct: number; // fraction
  gstPct: number; // fraction
}

export const DEFAULT_SETTINGS: Settings = { entity: "AWS_INC", markupPct: 0.035, gstPct: 0.18 };

/** Settings as the API stores them. */
export interface ServerSettings {
  entity: Entity;
  markup_pct: number;
  gst_pct: number;
  digest: "monthly" | "off";
  threshold_inr: number | null;
}

/**
 * GET /spend response (built by backend/src/report.py build_summary). The
 * dashboard relies on the raw inputs (usd, fx, services, days) so it can
 * recompute instantly when the user edits assumptions.
 */
export interface SpendResponse {
  month: string; // "YYYY-MM"
  asOf: string; // "YYYY-MM-DD"
  usd: number; // gross usage before credits, excluding tax
  fx: { rate: number; fetchedAt: string; source: string };
  breakdown: { base: number; markup: number; gst: number; total: number };
  projection: number;
  services: { name: string; usd: number; inr: number }[]; // top 5 by spend
  otherUsd: number;
  otherInr: number;
  daysElapsed: number;
  daysInMonth: number;
  settings: ServerSettings;
  cachedAt?: string | null; // when Cost Explorer was last actually queried
  source?: string;
  excludes?: string[];
}

export interface Me {
  email: string;
  emailConfirmed: boolean;
  externalId: string;
  connected: boolean;
  roleArn: string | null;
  isOwner: boolean;
  settings: ServerSettings;
}
