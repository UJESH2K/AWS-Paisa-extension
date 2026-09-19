"use client";

import type { Entity } from "@/lib/convert";
import type { Settings } from "@/lib/types";
import { Card } from "./ui";

const ENTITIES: { value: Entity; label: string; hint: string }[] = [
  { value: "AWS_INC", label: "AWS Inc (USD)", hint: "Card charged in USD; your bank adds its forex markup and GST." },
  { value: "AISPL", label: "AISPL (INR)", hint: "Invoiced in INR with GST already applied; no card forex markup." },
];

export default function SettingsCard({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const isInc = settings.entity === "AWS_INC";
  const hint = ENTITIES.find((e) => e.value === settings.entity)?.hint;

  return (
    <Card title="Your assumptions">
      <fieldset>
        <legend className="mb-2 text-sm text-muted">Which AWS entity bills you?</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
          {ENTITIES.map((e) => (
            <label
              key={e.value}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                settings.entity === e.value ? "bg-raised text-fg" : "text-muted hover:text-fg"
              }`}
            >
              <input
                type="radio"
                name="entity"
                value={e.value}
                checked={settings.entity === e.value}
                onChange={() => onChange({ ...settings, entity: e.value })}
                className="sr-only"
              />
              {e.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">{hint} Your AWS invoice names the entity that billed you.</p>
      </fieldset>

      <div className={`mt-5 ${isInc ? "" : "opacity-40"}`}>
        <div className="flex items-baseline justify-between text-sm">
          <label htmlFor="markup" className="text-muted">
            Card forex markup
          </label>
          <span className="num">{(settings.markupPct * 100).toFixed(1)}%</span>
        </div>
        <input
          id="markup"
          type="range"
          min={0}
          max={5}
          step={0.1}
          disabled={!isInc}
          value={settings.markupPct * 100}
          onChange={(e) => onChange({ ...settings, markupPct: Number(e.target.value) / 100 })}
          className="mt-2 w-full"
        />
        <p className="mt-1 text-xs text-faint">Check your card&apos;s terms. Default 3.5% is a typical figure, not yours.</p>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-sm">
          <label htmlFor="gst" className="text-muted">
            GST
          </label>
          <span className="num">{(settings.gstPct * 100).toFixed(0)}%</span>
        </div>
        <input
          id="gst"
          type="range"
          min={0}
          max={28}
          step={1}
          value={settings.gstPct * 100}
          onChange={(e) => onChange({ ...settings, gstPct: Number(e.target.value) / 100 })}
          className="mt-2 w-full"
        />
      </div>
      <p className="mt-4 text-xs text-faint">Saved in this browser. Changes recalculate instantly.</p>
    </Card>
  );
}
