"use client";

import { useState } from "react";
import { emailSummary, updateSettings } from "@/lib/api";
import type { ServerSettings } from "@/lib/types";
import { Button, Card } from "./ui";

export default function EmailCard({ token, settings }: { token: string; settings: ServerSettings }) {
  const [digest, setDigest] = useState(settings.digest);
  const [threshold, setThreshold] = useState(settings.threshold_inr ? String(settings.threshold_inr) : "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const saveThreshold = () =>
    run(async () => {
      const n = threshold.trim() === "" ? null : Number(threshold);
      if (n !== null && (!Number.isFinite(n) || n < 1)) throw new Error("Enter a rupee amount, or leave it empty to turn the alert off.");
      await updateSettings(token, { threshold_inr: n });
      return n === null ? "Alert turned off." : "Saved. You'll get an email if the projected bill goes above that.";
    });

  return (
    <Card title="Email">
      <p className="text-sm text-muted">
        Get your rupee bill in your inbox: the projected month-end total with GST, on the 15th, and the final
        estimate on the 1st.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <label htmlFor="digest" className="text-muted">
          Monthly digest
        </label>
        <select
          id="digest"
          value={digest}
          onChange={(e) => {
            const v = e.target.value as ServerSettings["digest"];
            setDigest(v);
            void run(async () => {
              await updateSettings(token, { digest: v });
              return v === "monthly" ? "Monthly digest on." : "Monthly digest off.";
            });
          }}
          className="h-9 rounded-lg border border-line bg-bg px-2 text-sm"
        >
          <option value="monthly">On</option>
          <option value="off">Off</option>
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="threshold" className="text-sm text-muted">
          Alert me if the projected bill goes above (₹)
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="threshold"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="e.g. 5000"
            className="num h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm placeholder:text-faint"
          />
          <Button variant="ghost" onClick={saveThreshold} disabled={busy}>
            Save
          </Button>
        </div>
      </div>

      <Button
        className="mt-5 w-full"
        disabled={busy}
        onClick={() => run(async () => `Sent to ${(await emailSummary(token)).sentTo}. Check your inbox (and spam).`)}
      >
        {busy ? "Working…" : "Email me this summary now"}
      </Button>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            note.ok ? "border-accent/40 bg-accent-soft text-accent" : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {note.text}
        </p>
      )}
    </Card>
  );
}
