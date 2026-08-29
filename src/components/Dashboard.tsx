"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AcuityLevel } from "@/lib/types";
import type { DashboardState } from "@/lib/view";
import { DemoScript } from "./DemoScript";
import { EquityPanel } from "./EquityPanel";
import { EvidencePanel } from "./EvidencePanel";
import { PatientDrawer } from "./PatientDrawer";
import { QueueTable } from "./QueueTable";
import { AuditLog, FlowPanel, SurgePanel } from "./SidePanels";
import { StatStrip } from "./StatStrip";
import { TopBar } from "./TopBar";
import { Segmented, Skeleton } from "./ui";

type Tab = "equity" | "evidence" | "surge" | "flow" | "audit";

const TABS: { value: Tab; label: string }[] = [
  { value: "equity", label: "Override audit" },
  { value: "evidence", label: "Evidence" },
  { value: "surge", label: "Surge" },
  { value: "flow", label: "Flow" },
  { value: "audit", label: "Log" },
];

/** Poll cadence. Fast enough that a 300× clock looks continuous. */
const POLL_MS = 1000;

export function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("equity");
  const equityRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
      setState((await res.json()) as DashboardState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /** Every mutation returns the fresh dashboard state, so one round trip suffices. */
  const post = useCallback(async (url: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `${url} returned ${res.status}`);
      }
      setState((await res.json()) as DashboardState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const jumpToDeterioration = useCallback(() => {
    if (!state) return;
    const hero = state.patients.find(
      (p) => p.id === state.story.deteriorationPatientId,
    );
    setSelectedId(state.story.deteriorationPatientId);
    const target = hero ? hero.arrivalSimMinutes + 90 : state.simMinutes + 90;
    void post("/api/clock", { action: "goto", simMinutes: target });
  }, [state, post]);

  const showEquity = useCallback(() => {
    setSelectedId(null);
    setTab("equity");
    equityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Escape closes the sheet, as it would anywhere on the platform.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Loading. A layout-shaped skeleton rather than a bare spinner, so the page
  // does not jump when the first payload lands.
  if (!state) {
    return (
      <main className="min-h-screen animate-fadeIn px-4 py-4">
        <div className="glass-bar mb-5 h-[86px] rounded-card" />
        <div className="glass mb-5 flex divide-x divide-sep rounded-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex-1 space-y-2.5 px-5 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="glass space-y-3 rounded-card p-5 xl:col-span-7">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-ctl" />
            ))}
          </div>
          <div className="glass space-y-3 rounded-card p-5 xl:col-span-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-24 w-full rounded-ctl" />
            <Skeleton className="h-40 w-full rounded-ctl" />
          </div>
        </div>
        <p
          className="mt-5 text-center text-footnote text-label-2"
          role="status"
          aria-live="polite"
        >
          {error ? `Could not load the department: ${error}` : "Loading department…"}
        </p>
      </main>
    );
  }

  const selected = state.patients.find((p) => p.id === selectedId) ?? null;

  return (
    <main className="min-h-screen pb-12">
      <TopBar
        state={state}
        busy={busy}
        onClock={(body) => void post("/api/clock", body)}
        onReset={() => {
          setSelectedId(null);
          void post("/api/reset");
        }}
      />

      {error && (
        <div className="mx-3 mt-3 rounded-ctl bg-tint-red px-4 py-2 text-footnote text-sys-red shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.5)]">
          {error}
        </div>
      )}

      <div className="mx-auto max-w-[1700px] space-y-5 px-4 py-5">
        <StatStrip state={state} />

        <DemoScript
          state={state}
          busy={busy}
          onJumpToDeterioration={jumpToDeterioration}
          onShowEquity={showEquity}
        />

        <div className="grid gap-5 xl:grid-cols-12">
          <div className="space-y-5 xl:col-span-7">
            <QueueTable
              state={state}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
            />
          </div>

          <div ref={equityRef} className="space-y-4 xl:col-span-5">
            <Segmented
              className="w-full max-w-md"
              options={TABS}
              value={tab}
              onChange={setTab}
            />

            <div key={tab} className="animate-riseIn">
              {tab === "equity" && (
                <EquityPanel equity={state.equity} highlightTag={state.story.equityGroup} />
              )}
              {tab === "evidence" && <EvidencePanel analysis={state.analysis} />}
              {tab === "surge" && <SurgePanel surge={state.surge} />}
              {tab === "flow" && <FlowPanel routing={state.routing} beds={state.beds} />}
              {tab === "audit" && <AuditLog events={state.events} />}
            </div>
          </div>
        </div>
      </div>

      {/* Patient sheet -------------------------------------------------- */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-40 animate-fadeIn bg-[rgba(28,30,45,0.18)] backdrop-blur-[3px]"
            onClick={() => setSelectedId(null)}
            aria-hidden
          />
          <div className="fixed right-0 top-0 z-50 h-screen w-full max-w-[620px] animate-sheetIn p-4">
            <PatientDrawer
              patient={selected}
              state={state}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onOverride={(acuity: AcuityLevel, reason: string) =>
                void post("/api/override", {
                  patientId: selected.id,
                  acuity,
                  reason,
                })
              }
              onAccept={() =>
                void post("/api/override", { patientId: selected.id, accept: true })
              }
              onRescore={() =>
                void post("/api/score", { patientId: selected.id, force: true })
              }
            />
          </div>
        </>
      )}
    </main>
  );
}
