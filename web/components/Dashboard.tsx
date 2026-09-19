"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getSpend, isApiConfigured, updateSettings } from "@/lib/api";
import { convert, effectiveRate } from "@/lib/convert";
import { SAMPLE_SPEND } from "@/lib/demo";
import { dateTimeIST, monthLabel } from "@/lib/format";
import { clearSession, loadSession, loadSettings, saveSettings, type Session } from "@/lib/session";
import { DEFAULT_SETTINGS, type Settings, type SpendResponse } from "@/lib/types";
import BreakdownCard from "./BreakdownCard";
import FxCard from "./FxCard";
import ProjectionCard from "./ProjectionCard";
import ServicesCard from "./ServicesCard";
import SettingsCard from "./SettingsCard";
import { Button, Chip } from "./ui";

type State =
  | { status: "loading" }
  | { status: "ready"; spend: SpendResponse; source: "live" | "sample" }
  | { status: "error"; message: string };

export default function Dashboard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<Session | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasSavedSettings = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (s: Session | null) => {
    if (!isApiConfigured || !s) {
      setState({ status: "ready", spend: SAMPLE_SPEND, source: "sample" });
      return;
    }
    try {
      const spend = await getSpend(s.token);
      if (!hasSavedSettings.current) {
        setSettings({
          entity: spend.settings.entity,
          markupPct: spend.settings.markup_pct,
          gstPct: spend.settings.gst_pct,
        });
      }
      setState({ status: "ready", spend, source: "live" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearSession();
        setSession(null);
        setState({ status: "ready", spend: SAMPLE_SPEND, source: "sample" });
        return;
      }
      setState({ status: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, []);

  useEffect(() => {
    const saved = loadSettings();
    hasSavedSettings.current = saved !== null;
    const s = loadSession();
    const init = async () => {
      if (saved) setSettings(saved);
      setSession(s);
      await load(s);
    };
    void init();
  }, [load]);

  const onSettings = (next: Settings) => {
    setSettings(next);
    hasSavedSettings.current = true;
    saveSettings(next);
    if (isApiConfigured && session) {
      clearTimeout(syncTimer.current);
      // Best effort: keeps the server-side alert check on the same assumptions.
      syncTimer.current = setTimeout(() => void updateSettings(session.token, next).catch(() => {}), 600);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(session);
    setRefreshing(false);
  };

  const result = useMemo(() => {
    if (state.status !== "ready") return null;
    const { spend } = state;
    const daysElapsed = Math.max(1, spend.daysElapsed);
    try {
      return convert({
        usdSpend: spend.usd,
        fxRate: spend.fx.rate,
        markupPct: settings.markupPct,
        gstPct: settings.gstPct,
        entity: settings.entity,
        daysElapsed,
        daysInMonth: Math.max(spend.daysInMonth, daysElapsed),
      });
    } catch {
      return null;
    }
  }, [state, settings]);

  if (state.status === "loading") return <Skeleton />;

  if (state.status === "error") {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/10 p-6" role="alert">
        <h1 className="text-lg font-semibold">Couldn&apos;t load your spend</h1>
        <p className="mt-1 text-sm text-muted">{state.message}</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={refresh}>Try again</Button>
          <Link href="/connect" className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm hover:bg-raised">
            Reconnect AWS
          </Link>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/10 p-6" role="alert">
        <h1 className="text-lg font-semibold">Unexpected data from the API</h1>
        <p className="mt-1 text-sm text-muted">The FX rate or spend figure was missing or invalid.</p>
      </div>
    );
  }

  const { spend, source } = state;
  const rate = effectiveRate(spend.fx.rate, settings.entity, settings.markupPct, settings.gstPct);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your AWS bill, in rupees</h1>
          <p className="mt-1 text-sm text-muted">
            What actually leaves your account, after forex, card markup and GST.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {source === "live" ? <Chip tone="accent">Live · your account</Chip> : <Chip tone="warn">Sample data</Chip>}
          <Button variant="ghost" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {source === "sample" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-markup/30 bg-markup/10 px-4 py-3 text-sm">
          <p>
            <strong className="font-medium text-markup">This is sample data, not your account.</strong>{" "}
            <span className="text-muted">
              {isApiConfigured
                ? "Connect a read-only AWS role to see your real spend."
                : "The Paisa API URL isn't configured for this build (NEXT_PUBLIC_API_URL)."}
            </span>
          </p>
          <Link href="/connect" className="inline-flex h-8 items-center rounded-lg bg-markup px-3 text-xs font-medium text-bg hover:brightness-110">
            Connect AWS
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard r={result} monthText={monthLabel(spend.month)} />
        <div className="space-y-4">
          <ProjectionCard r={result} />
          <FxCard rate={spend.fx.rate} fetchedAt={spend.fx.fetchedAt} />
        </div>
        <ServicesCard services={spend.services} totalUsd={spend.usd} effectiveRate={rate} />
        <SettingsCard settings={settings} onChange={onSettings} />
      </div>

      {source === "live" && spend.cachedAt && (
        <p className="text-xs text-faint">
          Spend data cached from AWS Cost Explorer at {dateTimeIST(spend.cachedAt)}. Cost Explorer bills per
          request, so Paisa serves a cached copy for a few hours.
        </p>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-16 w-72 animate-pulse rounded-lg bg-surface" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-xl bg-surface lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-xl bg-surface" />
      </div>
    </div>
  );
}
