import type { ConvertResult } from "@/lib/convert";
import { inr, pct, usd } from "@/lib/format";
import { Card, Chip } from "./ui";

export default function BreakdownCard({ r, monthText }: { r: ConvertResult; monthText: string }) {
  const parts = [
    { key: "Base", value: r.inrBase, color: "bg-accent" },
    { key: "Card markup", value: r.inrMarkup, color: "bg-markup" },
    { key: "GST", value: r.inrGst, color: "bg-gst" },
  ];
  const isInc = r.entity === "AWS_INC";
  const rows = [
    {
      label: "AWS console spend",
      input: `${usd(r.usdSpend)} × ${inr(r.fxRate, 2)}/USD`,
      amount: r.inrBase,
      swatch: "bg-accent",
    },
    {
      label: "Card forex markup",
      input: isInc ? `${pct(r.markupPct)} of base` : "not applicable (AISPL)",
      amount: r.inrMarkup,
      swatch: "bg-markup",
    },
    {
      label: "GST",
      input: `${pct(r.gstPct)} of ${isInc ? "base + markup" : "base"}`,
      amount: r.inrGst,
      swatch: "bg-gst",
    },
  ];

  return (
    <Card title={`Month to date · ${monthText}`} aside={<Chip tone="warn">Estimate</Chip>} className="lg:col-span-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="num text-5xl font-semibold tracking-tight sm:text-6xl">{inr(r.inrTotal)}</p>
        <p className="num pb-2 text-sm text-muted">
          the console shows <span className="text-fg">{usd(r.usdSpend)}</span>
        </p>
      </div>

      <div
        className="mt-6 flex h-2.5 w-full overflow-hidden rounded-full bg-raised"
        role="img"
        aria-label={`Of ${inr(r.inrTotal)}: base ${inr(r.inrBase)}, markup ${inr(r.inrMarkup)}, GST ${inr(r.inrGst)}`}
      >
        {parts.map((p) => (
          <div
            key={p.key}
            className={p.color}
            style={{ width: `${r.inrTotal > 0 ? (p.value / r.inrTotal) * 100 : 0}%` }}
          />
        ))}
      </div>

      <table className="mt-5 w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <td className="py-3 pr-3">
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${row.swatch}`} aria-hidden />
                  {row.label}
                </span>
              </td>
              <td className="num hidden py-3 pr-3 text-muted sm:table-cell">{row.input}</td>
              <td className="num py-3 text-right">{inr(row.amount, 2)}</td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="py-3 pr-3 font-medium">Total (estimate)</td>
            <td className="hidden sm:table-cell" />
            <td className="num py-3 text-right font-semibold">{inr(r.inrTotal, 2)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-faint sm:hidden">
        {rows.map((x) => `${x.label}: ${x.input}`).join(" · ")}
      </p>
      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        {isInc
          ? "AWS Inc bills your card in USD: base = USD × FX rate, the bank adds its markup on the base, and GST applies to base + markup."
          : "AISPL invoices in INR with GST: base = USD × FX rate, GST applies to the base, and there is no card forex markup."}{" "}
        Cost Explorer&apos;s unblended cost is the USD input.
      </p>
    </Card>
  );
}
