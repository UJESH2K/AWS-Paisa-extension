import { inr, usd } from "@/lib/format";
import { Card } from "./ui";

interface Props {
  services: { name: string; usd: number }[];
  totalUsd: number;
  effectiveRate: number; // INR per USD, all-in
}

export default function ServicesCard({ services, totalUsd, effectiveRate }: Props) {
  const listed = services.reduce((s, x) => s + x.usd, 0);
  const other = Math.max(totalUsd - listed, 0);
  const rows = other > 0.005 ? [...services, { name: "Everything else", usd: other }] : services;
  const max = Math.max(...rows.map((r) => r.usd), 0.0001);

  return (
    <Card title="Top services" className="lg:col-span-2">
      <ul className="space-y-4">
        {rows.map((s) => (
          <li key={s.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{s.name}</span>
              <span className="num shrink-0">
                {inr(s.usd * effectiveRate)}
                <span className="ml-2 text-xs text-muted">{usd(s.usd)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${s.name === "Everything else" ? "bg-faint" : "bg-accent"}`}
                style={{ width: `${(s.usd / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-faint">
        Per-service rupee figures use the same all-in rate: {inr(effectiveRate, 2)} per USD (FX, markup and GST
        included).
      </p>
    </Card>
  );
}
