"use client";

import { formatDuration, formatSimTime } from "@/lib/clock";
import type { DashboardState } from "@/lib/view";
import { Button, Pill, cx } from "./ui";

/**
 * The built-in demo narrative. A judge should not have to guess what to look at:
 * these two cards state the claim, then move the simulation to the moment that
 * proves it.
 */
export function DemoScript({
  state,
  busy,
  onJumpToDeterioration,
  onShowEquity,
}: {
  state: DashboardState;
  busy: boolean;
  onJumpToDeterioration: () => void;
  onShowEquity: () => void;
}) {
  const hero = state.patients.find(
    (p) => p.id === state.story.deteriorationPatientId,
  );
  // findings are already ordered most-defensible-first by buildEquityReport,
  // so the first notable one for this route is the one worth quoting.
  const equityFinding =
    state.equity.findings.find(
      (f) => f.tag === state.story.equityGroup && f.notable,
    ) ?? state.equity.findings.find((f) => f.notable);

  const heroCrossed = hero?.escalationCrossedAtMinutes !== null && hero !== undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Story 1 -------------------------------------------------------- */}
      <div
        className={cx(
          "glass-interactive rounded-card p-4 transition-colors duration-300",
          heroCrossed ? "glass glass-tint-red" : "glass",
        )}
      >
        <div className="flex items-center gap-2">
          <Pill tone="red">Story 1</Pill>
          <h3 className="display-tight text-subhead font-semibold text-label">
            Silent deterioration
          </h3>
        </div>
        <p className="mt-2 text-caption leading-[17px] text-label-2">
          {hero ? (
            <>
              <span className="font-medium text-label">{hero.name}</span>, 58,
              walked in with <em>indigestion after yard work</em>. Every arrival
              vital was normal — NEWS 0 — and a nurse had already downgraded him
              one level as likely reflux. A static intake score would leave him
              exactly where he started for the rest of his wait.
            </>
          ) : (
            "Loading the cohort…"
          )}
        </p>

        {hero && (
          <div className="mt-2.5 grid grid-cols-4 divide-x divide-sep rounded-ctl glass-soft py-2">
            {[
              { label: "Queue", value: `#${hero.rank}`, delta: hero.rankDelta },
              { label: "Urgency", value: hero.urgency.toFixed(0) },
              { label: "NEWS", value: String(hero.news) },
              { label: "Waited", value: formatDuration(hero.waitMinutes) },
            ].map((k) => (
              <div key={k.label} className="px-1 text-center">
                <div className="text-caption2 font-medium uppercase tracking-[0.05em] text-label-3">
                  {k.label}
                </div>
                <div className="tnum display-tight mt-1 text-headline font-semibold leading-none text-label">
                  {k.value}
                  {k.delta !== undefined && k.delta > 0 && (
                    <span className="ml-0.5 align-super text-caption2 font-bold text-st-critical">
                      ▲{k.delta}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button size="sm" tone="primary" disabled={busy} onClick={onJumpToDeterioration}>
            Fast-forward 90 min &amp; open his chart
          </Button>
          {heroCrossed && hero && (
            <span className="text-caption font-medium text-sys-red">
              crossed escalation at +
              {formatDuration(hero.escalationCrossedAtMinutes!)}
            </span>
          )}
        </div>
      </div>

      {/* Story 2 -------------------------------------------------------- */}
      <div
        className={cx(
          "glass-interactive rounded-card p-4 transition-colors duration-300",
          equityFinding ? "glass glass-tint-red" : "glass",
        )}
      >
        <div className="flex items-center gap-2">
          <Pill tone="indigo">Story 2</Pill>
          <h3 className="display-tight text-subhead font-semibold text-label">
            A gap in the override layer
          </h3>
        </div>
        <p className="mt-2 text-caption leading-[17px] text-label-2">
          Nothing about who a patient is is recorded anywhere in this system.
          The audit still catches an uneven override layer — by looking at how
          people arrived, and at overrides that contradict a patient&apos;s own
          vital signs. No profiling required, and no individual score touched.
        </p>

        {state.equity.contradictions.length > 0 ? (
          <p className="mt-3 rounded-ctl glass-soft px-3 py-2.5 text-footnote leading-[18px] text-label">
            <span className="font-medium">
              {state.equity.contradictions.length} downgrade
              {state.equity.contradictions.length === 1 ? "" : "s"} contradicted
              the patient&apos;s own vital signs.
            </span>{" "}
            That check needs no grouping and no statistical power — each patient
            is compared only against themselves, so it fires on the first unsafe
            override instead of waiting for a pattern to accumulate.
            {equityFinding
              ? ` The group-level route gap also survives correction (z = ${equityFinding.z}).`
              : ` The group-level route gap is suggestive but does not survive correction across ${state.equity.testsRun} comparisons on a single shift — the honest result at this cohort size.`}
          </p>
        ) : equityFinding ? (
          <p className="mt-3 rounded-ctl glass-soft px-3 py-2.5 text-footnote leading-[18px] text-label">
            {equityFinding.message}{" "}
            <span className="tnum font-medium text-sys-red">
              (z = {equityFinding.z})
            </span>
          </p>
        ) : (
          <p className="mt-3 rounded-ctl glass-soft px-3 py-2.5 text-footnote leading-[18px] text-label-2">
            {state.scoredCount < state.totalPatients
              ? `Waiting on the local model — ${state.scoredCount}/${state.totalPatients} patients scored. Seeded overrides apply as each score lands.`
              : "No notable gap detected in the current cohort."}
          </p>
        )}

        <div className="mt-3">
          <Button size="sm" tone="primary" disabled={busy} onClick={onShowEquity}>
            Open the equity audit
          </Button>
        </div>
      </div>

      <p className="col-span-full px-1 text-caption leading-[16px] text-label-3">
        Simulated clock is at {formatSimTime(state.simMinutes)}. Use the speed
        controls in the header to watch the queue re-sort continuously, or the
        jump buttons to move straight to a moment. Everything on this screen is
        synthetic.
      </p>
    </div>
  );
}
