import { dateTimeIST, inr } from "@/lib/format";
import { Card } from "./ui";

export default function FxCard({ rate, fetchedAt }: { rate: number; fetchedAt: string }) {
  return (
    <Card title="USD → INR rate">
      <p className="num text-3xl font-semibold tracking-tight">{inr(rate, 2)}</p>
      <p className="mt-1 text-sm text-muted">mid-market, as of {dateTimeIST(fetchedAt)}</p>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        Refreshed daily. Your bank converts at its own rate on the settlement date, not the day the usage
        occurred, so the final debit will differ a little.
      </p>
    </Card>
  );
}
