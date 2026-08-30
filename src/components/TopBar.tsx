"use client";

import { RATE_PRESETS, formatSimTime } from "@/lib/clock";
import type { DashboardState } from "@/lib/view";
import { Button, Pill, Segmented, cx } from "./ui";

export function DisclaimerBanner() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-t-card bg-tint-yellow px-4 py-[7px] text-center">
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 shrink-0 fill-sys-yellow"
        aria-hidden
      >
        <path d="M8 1.6 15 14H1L8 1.6Zm0 3.6a.7.7 0 0 0-.7.75l.2 3.4a.5.5 0 0 0 1 0l.2-3.4A.7.7 0 0 0 8 5.2Zm0 5.4a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" />
      </svg>
      <p className="text-caption font-medium text-label">
        Prototype / demo only · not a medical device · not clinically validated ·
        all patients and data on this screen are synthetic
      </p>
    </div>
  );
}

function StatusDot({ tone }: { tone: "green" | "yellow" | "red" | "blue" }) {
  const map = {
    green: "bg-sys-green",
    yellow: "bg-sys-yellow",
    red: "bg-sys-red",
    blue: "bg-sys-blue",
  };
  return (
    <span
      className={cx(
        "h-[7px] w-[7px] rounded-full shadow-[inset_0_0.5px_0_rgba(255,255,255,0.6)]",
        map[tone],
      )}
    />
  );
}

function OllamaChip({ state }: { state: DashboardState }) {
  const o = state.ollama;
  const usingFallback = state.patients.some(
    (p) => p.ai?.source === "heuristic-fallback",
  );

  if (!o || !o.reachable) {
    return (
      <Pill tone="red" title={o?.error ?? "Ollama status unknown"}>
        <StatusDot tone="red" />
        Ollama offline — rule-based fallback
      </Pill>
    );
  }
  if (!o.modelInstalled) {
    return (
      <Pill
        tone="orange"
        title={`Installed: ${o.installedModels.join(", ") || "none"}`}
      >
        <StatusDot tone="yellow" />
        {o.configuredModel} not pulled
      </Pill>
    );
  }
  return (
    <Pill
      tone={usingFallback ? "orange" : "green"}
      title={`${o.host} · ${o.configuredModel}`}
    >
      <StatusDot tone={usingFallback ? "yellow" : "green"} />
      {o.configuredModel}
      {usingFallback ? " · some fallback scores" : ""}
    </Pill>
  );
}

export function TopBar({
  state,
  busy,
  onClock,
  onReset,
  onSurge,
}: {
  state: DashboardState;
  busy: boolean;
  onClock: (body: Record<string, unknown>) => void;
  onReset: () => void;
  onSurge: () => void;
}) {
  const scoring = state.scoringInFlight > 0;
  const hours = Math.floor(state.simMinutes / 60);
  const mins = String(Math.floor(state.simMinutes % 60)).padStart(2, "0");

  return (
    // Floating chrome: the bar hovers over the content it blurs, rather than
    // being welded to the top edge.
    <header className="sticky top-0 z-30 px-4 pt-4">
      <div className="glass-bar overflow-hidden rounded-card">
        <DisclaimerBanner />

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3.5 border-t border-sep px-5 py-3.5">
          {/* Identity ---------------------------------------------------- */}
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-ctl bg-sys-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2px_8px_rgba(0,90,190,0.32)]">
              <svg
                viewBox="0 0 20 20"
                className="h-[18px] w-[18px] fill-none stroke-white"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 11h3.2l1.6-4.4 2.6 8 2-5.2 1.3 1.6H18" />
              </svg>
            </span>
            <div className="leading-none">
              <h1 className="display text-headline font-semibold tracking-tight text-label">
                Adaptive Triage
              </h1>
              <p className="mt-1 text-caption text-label-2">
                continuous re-scoring · ED waiting room
              </p>
            </div>
          </div>

          {/* Clock ------------------------------------------------------- */}
          <div className="glass-soft flex items-center gap-3 rounded-ctl px-3 py-1.5">
            <div className="leading-none">
              <div className="text-caption2 font-medium uppercase tracking-[0.06em] text-label-3">
                Sim time
              </div>
              <div className="tnum display mt-1 text-title3 font-semibold text-label">
                {formatSimTime(state.simMinutes)}
              </div>
            </div>
            <div className="tnum h-8 border-l border-sep pl-3 text-caption leading-[15px] text-label-2">
              +{hours}h{mins}
              <br />
              into shift
            </div>
          </div>

          {/* Transport --------------------------------------------------- */}
          <div className="flex items-center gap-2">
            <Segmented
              className="w-[252px]"
              disabled={busy}
              value={
                RATE_PRESETS.find((r) => Math.abs(state.rate - r.value) < 1e-9)?.label ??
                "Paused"
              }
              onChange={(label) => {
                const preset = RATE_PRESETS.find((r) => r.label === label);
                if (preset) onClock({ action: "rate", rate: preset.value });
              }}
              options={RATE_PRESETS.map((r) => ({
                value: r.label,
                label: r.label,
                title:
                  r.value === 0
                    ? "Pause simulated time"
                    : `${Math.round(r.value * 60)} simulated minutes per real minute`,
              }))}
            />

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onClock({ action: "jump", minutes: -30 })}
                title="Rewind 30 simulated minutes"
              >
                −30m
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onClock({ action: "jump", minutes: 15 })}
              >
                +15m
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onClock({ action: "jump", minutes: 60 })}
              >
                +1h
              </Button>
            </div>
          </div>

          {/* Status ------------------------------------------------------ */}
          <div className="ml-auto flex items-center gap-2.5">
            {scoring && (
              <Pill tone="blue">
                <span className="h-[7px] w-[7px] animate-breathe rounded-full bg-sys-blue" />
                scoring {state.scoredCount}/{state.totalPatients}
              </Pill>
            )}
            {state.reassessOverdue > 0 && (
              <Pill
                tone="red"
                title="Patients waiting longer than their acuity level safely permits. Mandatory re-assessment is triggered by elapsed time, independent of whether their score has drifted."
              >
                <StatusDot tone="red" />
                {state.reassessOverdue} re-assess overdue
              </Pill>
            )}
            <Button
              size="sm"
              tone={state.surgeActive ? "danger" : "default"}
              disabled={busy || state.surgeActive}
              onClick={onSurge}
              title={
                state.surgeActive
                  ? "Surge cohort already admitted"
                  : "Admit 12 further arrivals in ~11 simulated minutes — roughly 3x the normal rate. No scoring threshold changes."
              }
            >
              {state.surgeActive ? "Surge active" : "Simulate 3× surge"}
            </Button>
            <OllamaChip state={state} />
            <Button
              size="sm"
              tone="ghost"
              disabled={busy}
              onClick={onReset}
              title="Reseed the synthetic cohort and restart the demo"
            >
              Reset demo
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
