import type { ConvertResult } from "@/lib/convert";
import { inr } from "@/lib/format";
import { Card } from "./ui";

export default function ProjectionCard({ r }: { r: ConvertResult }) {
  const progress = (r.daysElapsed / r.daysInMonth) * 100;
  const perDay = r.inrTotal / r.daysElapsed;
  return (
    <Card title="Projected month-end">
      <p className="num text-4xl font-semibold tracking-tight">{inr(r.projection)}</p>
      <p className="mt-1 text-sm text-muted">estimate, at your current pace of {inr(perDay)} a day</p>

      <div className="mt-6">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={r.daysInMonth}
          aria-valuenow={r.daysElapsed}
          aria-label="Days of the month elapsed"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
        <div className="num mt-2 flex justify-between text-xs text-muted">
          <span>Day {r.daysElapsed}</span>
          <span>{r.daysInMonth} days</span>
        </div>
      </div>
      <p className="mt-4 text-xs text-faint">
        {inr(r.inrTotal)} ÷ {r.daysElapsed} days × {r.daysInMonth} days
      </p>
    </Card>
  );
}
