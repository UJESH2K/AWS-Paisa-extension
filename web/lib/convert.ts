// TypeScript port of backend/src/convert.py so the dashboard can recompute
// instantly when the user edits entity / markup / GST. The Python module is the
// source of truth; keep the two in sync. All outputs are estimates.

export type Entity = "AWS_INC" | "AISPL";

export interface ConvertInput {
  usdSpend: number;
  fxRate: number;
  markupPct: number; // fraction, 0.035 == 3.5%
  gstPct: number; // fraction
  entity: Entity;
  daysElapsed: number;
  daysInMonth: number;
}

export interface ConvertResult extends ConvertInput {
  inrBase: number;
  inrMarkup: number;
  inrGst: number;
  inrTotal: number;
  projection: number;
}

export function convert(i: ConvertInput): ConvertResult {
  if (i.usdSpend < 0) throw new Error("usdSpend must be >= 0");
  if (i.fxRate <= 0) throw new Error("fxRate must be > 0");
  if (i.daysElapsed < 1) throw new Error("daysElapsed must be >= 1");
  if (i.daysInMonth < i.daysElapsed) throw new Error("daysInMonth must be >= daysElapsed");

  const inrBase = i.usdSpend * i.fxRate;
  let inrMarkup = 0;
  let inrGst: number;
  if (i.entity === "AWS_INC") {
    inrMarkup = inrBase * i.markupPct;
    inrGst = (inrBase + inrMarkup) * i.gstPct;
  } else {
    inrGst = inrBase * i.gstPct;
  }
  const inrTotal = inrBase + inrMarkup + inrGst;
  const projection = (inrTotal / i.daysElapsed) * i.daysInMonth;

  return {
    ...i,
    markupPct: i.entity === "AWS_INC" ? i.markupPct : 0,
    inrBase,
    inrMarkup,
    inrGst,
    inrTotal,
    projection,
  };
}

/** INR you actually pay per 1 USD of console spend, all-in. */
export function effectiveRate(fxRate: number, entity: Entity, markupPct: number, gstPct: number) {
  const markup = entity === "AWS_INC" ? 1 + markupPct : 1;
  return fxRate * markup * (1 + gstPct);
}
