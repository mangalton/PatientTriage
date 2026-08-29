"use client";

import { formatDuration } from "@/lib/clock";
import type { DashboardState } from "@/lib/view";
import { cx } from "./ui";

/**
 * A glance-level summary across the top of the dashboard.
 *
 * Every figure here is derived from data already on screen — this adds no new
 * source, only a focal point. Without it the page goes straight from toolbar to
 * dense table with nothing for the eye to land on first.
 */
function Stat({
  label,
  value,
  unit,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  caption: string;
  tone?: "neutral" | "red" | "orange" | "green" | "blue";
}) {
  const toneText: Record<string, string> = {
    neutral: "text-label",
    red: "text-st-critical",
    orange: "text-st-escalated",
    green: "text-st-stable",
    blue: "text-sys-blue",
  };
  return (
    <div className="flex-1 px-5 py-4">
      <div className="text-caption font-medium uppercase tracking-[0.07em] text-label-3">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cx(
            "tnum display-tight text-title2 font-semibold leading-none",
            toneText[tone],
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-footnote font-medium text-label-3">{unit}</span>
        )}
      </div>
      <div className="mt-1.5 truncate text-caption text-label-2" title={caption}>
        {caption}
      </div>
    </div>
  );
}

export function StatStrip({ state }: { state: DashboardState }) {
  const patients = state.patients;

  const escalated = patients.filter(
    (p) => p.status === "escalated" || p.status === "critical",
  );
  const critical = patients.filter((p) => p.status === "critical");
  const longest = patients.reduce(
    (a, b) => (b.waitMinutes > a.waitMinutes ? b : a),
    patients[0],
  );
  const climbed = patients.filter((p) => p.rankDelta > 0);
  const biggestClimb = climbed.reduce(
    (a, b) => (b.rankDelta > a.rankDelta ? b : a),
    climbed[0],
  );
  const flagged = patients.filter(
    (p) => p.ai?.atypical_presentation_flag,
  ).length;

  return (
    <div className="glass flex flex-wrap divide-x divide-sep overflow-hidden rounded-card">
      <Stat
        label="Waiting"
        value={String(patients.length)}
        caption={`${flagged} carrying an atypical-presentation flag`}
      />
      <Stat
        label="Past threshold"
        value={String(escalated.length)}
        tone={escalated.length ? "orange" : "green"}
        caption={
          critical.length
            ? `${critical.length} of them now critical`
            : "none in the critical band"
        }
      />
      <Stat
        label="Longest wait"
        value={longest ? formatDuration(longest.waitMinutes) : "—"}
        tone="neutral"
        caption={longest ? `${longest.name} · ESI ${longest.effectiveAcuity}` : ""}
      />
      <Stat
        label="Re-prioritised"
        value={String(climbed.length)}
        tone={climbed.length ? "red" : "neutral"}
        caption={
          biggestClimb
            ? `${biggestClimb.name} up ${biggestClimb.rankDelta} since arrival`
            : "queue order unchanged since arrival"
        }
      />
    </div>
  );
}
