import type { SpendResponse } from "./types";

// SAMPLE DATA. Shown only when not signed in, always with a visible
// "Sample data" label. Numbers are illustrative, not real usage or a real FX rate.
// breakdown/projection are recomputed client-side from the raw inputs.
export const SAMPLE_SPEND: SpendResponse = {
  month: "2026-09",
  asOf: "2026-09-18",
  usd: 47.3,
  fx: { rate: 85.0, fetchedAt: "2026-09-19T00:30:00Z", source: "sample" },
  breakdown: { base: 0, markup: 0, gst: 0, total: 0 },
  projection: 0,
  services: [
    { name: "Amazon EC2", usd: 18.62, inr: 0 },
    { name: "Amazon RDS", usd: 11.4, inr: 0 },
    { name: "Amazon S3", usd: 6.85, inr: 0 },
    { name: "Amazon CloudFront", usd: 4.1, inr: 0 },
    { name: "AWS Lambda", usd: 2.95, inr: 0 },
  ],
  otherUsd: 3.38,
  otherInr: 0,
  daysElapsed: 18,
  daysInMonth: 30,
  settings: { entity: "AWS_INC", markup_pct: 0.035, gst_pct: 0.18, digest: "monthly", threshold_inr: null },
  providerNote: "Illustrative figures, not read from any AWS account.",
};
