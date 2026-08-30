"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDuration, formatSimTime } from "@/lib/clock";
import { RISK_FACTOR_WEIGHT, precautionaryUplift, urgencyTrace } from "@/lib/urgency";
import { AGE_BAND_LABEL, ewsContributions } from "@/lib/ews";
import { RISK_FACTOR_LABEL } from "@/lib/types";
import type { AcuityLevel, PatientSnapshot, Vitals } from "@/lib/types";
import type { DashboardState } from "@/lib/view";
import {
  ACUITY_STYLE,
  AcuityBadge,
  Button,
  Meter,
  Pill,
  STATUS_STYLE,
  SectionLabel,
  cx,
  CHART_TOOLTIP,
  CHART,
} from "./ui";

const VITAL_META: {
  key: keyof Vitals;
  label: string;
  unit: string;
  /** Which direction is clinically worrying. */
  worse: "up" | "down";
}[] = [
  { key: "hr", label: "HR", unit: "bpm", worse: "up" },
  { key: "sbp", label: "SBP", unit: "mmHg", worse: "down" },
  { key: "rr", label: "RR", unit: "/min", worse: "up" },
  { key: "spo2", label: "SpO₂", unit: "%", worse: "down" },
  { key: "temp", label: "Temp", unit: "°C", worse: "up" },
];

function VitalCell({
  label,
  unit,
  arrival,
  current,
  points,
  worse,
}: {
  label: string;
  unit: string;
  arrival: number;
  current: number;
  points: number;
  worse: "up" | "down";
}) {
  const delta = current - arrival;
  const moved = Math.abs(delta) >= (label === "SpO₂" || label === "Temp" ? 0.5 : 1);
  const bad = worse === "up" ? delta > 0 : delta < 0;

  return (
    <div
      className={cx(
        "rounded-ctl px-3 py-2.5",
        points >= 3 ? "bg-tint-red" : points >= 1 ? "bg-tint-orange" : "bg-fill",
      )}
      title={`NEWS contribution: ${points} point${points === 1 ? "" : "s"}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-caption2 font-medium uppercase tracking-[0.05em] text-label-3">
          {label}
        </span>
        {points > 0 && (
          <span className="tnum text-caption2 font-semibold text-sys-orange">
            +{points}
          </span>
        )}
      </div>
      <div className="tnum display mt-1 text-title3 font-semibold leading-none text-label">
        {current}
        <span className="ml-0.5 text-caption2 font-normal text-label-3">{unit}</span>
      </div>
      <div className="tnum mt-1.5 flex items-center gap-1 text-caption2 text-label-3">
        <span>{arrival}</span>
        {moved && (
          <span
            className={cx(
              "inline-flex items-center gap-[1px] font-semibold",
              bad ? "text-sys-red" : "text-sys-green",
            )}
          >
            <svg viewBox="0 0 10 10" className="h-2 w-2 fill-current" aria-hidden>
              {delta > 0 ? <path d="M5 1.5 9 7H1z" /> : <path d="M5 8.5 1 3h8z" />}
            </svg>
            {Math.abs(Math.round(delta * 10) / 10)}
          </span>
        )}
      </div>
    </div>
  );
}

function OverrideForm({
  patient,
  busy,
  onOverride,
  onAccept,
}: {
  patient: PatientSnapshot;
  busy: boolean;
  onOverride: (acuity: AcuityLevel, reason: string) => void;
  onAccept: () => void;
}) {
  const [level, setLevel] = useState<AcuityLevel | null>(null);
  const [reason, setReason] = useState("");

  const target = level ?? patient.effectiveAcuity;
  const canSubmit = level !== null && level !== patient.effectiveAcuity && !busy;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-0.5 text-footnote text-label-2">Set acuity to</span>
        {([1, 2, 3, 4, 5] as AcuityLevel[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(l)}
            className={cx(
              "flex h-8 w-8 items-center justify-center rounded-ctl text-subhead font-semibold text-white transition-all duration-150",
              ACUITY_STYLE[l].bg,
              target === l
                ? "scale-105 ring-2 ring-sys-blue ring-offset-2 ring-offset-white"
                : "opacity-35 hover:opacity-70",
            )}
            title={`ESI ${l} — ${ACUITY_STYLE[l].label}`}
          >
            {l}
          </button>
        ))}
      </div>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Reason for override (logged to the audit trail and the equity report)"
        className="w-full resize-none rounded-ctl bg-fill px-3 py-2 text-footnote text-label placeholder:text-label-3 focus:outline-none focus:ring-2 focus:ring-sys-blue"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={!canSubmit}
          onClick={() => {
            if (level === null) return;
            onOverride(level, reason);
            setReason("");
            setLevel(null);
          }}
        >
          {level !== null && level !== patient.effectiveAcuity
            ? level > patient.effectiveAcuity
              ? `Downgrade to ESI ${level}`
              : `Upgrade to ESI ${level}`
            : "Record override"}
        </Button>
        {patient.overrideAcuity !== null && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onAccept}
            title="Discard the override and return to the model's acuity"
          >
            Accept AI score (ESI {patient.ai?.acuity_level ?? "?"})
          </Button>
        )}
      </div>
      <p className="text-caption2 leading-[15px] text-label-3">
        Every override is logged with its reason and feeds the equity audit. The
        audit reports patterns across the cohort; it never alters an individual
        score.
      </p>
    </div>
  );
}

/** A grouped inset block inside the sheet. */
function Group({
  label,
  right,
  children,
  tone = "plain",
}: {
  label?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  tone?: "plain" | "indigo";
}) {
  return (
    <section>
      {(label || right) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label ? <SectionLabel>{label}</SectionLabel> : <span />}
          {right && <div className="-mt-1">{right}</div>}
        </div>
      )}
      <div
        className={cx(
          "rounded-card p-4",
          tone === "indigo" ? "glass-soft glass-tint-indigo" : "glass-soft",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function PatientDrawer({
  patient,
  state,
  busy,
  onClose,
  onOverride,
  onAccept,
  onRescore,
}: {
  patient: PatientSnapshot;
  state: DashboardState;
  busy: boolean;
  onClose: () => void;
  onOverride: (acuity: AcuityLevel, reason: string) => void;
  onAccept: () => void;
  onRescore: () => void;
}) {
  const t = CHART;
  const s = STATUS_STYLE[patient.status];
  const b = patient.urgencyBreakdown;
  const contrib = ewsContributions(patient.currentVitals, patient.age);

  const trace = useMemo(
    () =>
      urgencyTrace(
        patient.arrivalVitals,
        patient.trajectory,
        patient.effectiveAcuity,
        patient.ai?.atypical_presentation_flag ?? false,
        patient.ambient !== null,
        0,
        Math.max(120, patient.waitMinutes + 60),
        40,
        patient.ai?.risk_factors ?? [],
        patient.age,
        patient.ageBand,
      ),
    [patient],
  );

  const overrides = state.overrides.filter((o) => o.patientId === patient.id);

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-sheet glass-sheet">
      {/* Sheet toolbar ------------------------------------------------- */}
      <header className="flex items-start justify-between gap-3 border-b border-sep px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cx("h-2.5 w-2.5 rounded-full", s.dot)} title={s.label} />
            <h2 className="display truncate text-title3 font-semibold tracking-tight text-label">
              {patient.name}
            </h2>
            {patient.ai && (
              <AcuityBadge
                size="sm"
                level={patient.effectiveAcuity}
                overridden={patient.overrideAcuity !== null}
              />
            )}
          </div>
          <p className="tnum mt-1 text-caption text-label-2">
            {patient.id} · {patient.age}
            {patient.sex} · {AGE_BAND_LABEL[patient.ageBand]} · arrived {formatSimTime(patient.arrivalSimMinutes)} · waiting{" "}
            {formatDuration(patient.waitMinutes)} · queue position #{patient.rank}
            {patient.rankDelta > 0 && (
              <span className="ml-1 font-semibold text-sys-red">
                (▲{patient.rankDelta} since arrival)
              </span>
            )}
          </p>
        </div>
        <Button size="sm" tone="ghost" onClick={onClose} title="Close">
          Done
        </Button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {/* Presentation ------------------------------------------------ */}
        <section>
          <SectionLabel>Presentation</SectionLabel>
          <p className="text-body font-medium text-label">{patient.chiefComplaint}</p>
          <p className="mt-1.5 text-footnote leading-[18px] text-label-2">
            {patient.narrative}
          </p>
        </section>

        {/* Record on file ---------------------------------------------- */}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <SectionLabel>Record on file</SectionLabel>
            <span className="-mt-1 text-caption text-label-2">
              data completeness{" "}
              <span
                className={cx(
                  "tnum font-semibold",
                  patient.completeness.score >= 0.8
                    ? "text-st-stable"
                    : patient.completeness.score >= 0.5
                      ? "text-st-watch"
                      : "text-st-critical",
                )}
              >
                {Math.round(patient.completeness.score * 100)}%
              </span>
            </span>
          </div>
          {patient.priorRecord ? (
            <div className="space-y-2 rounded-card bg-elev2 p-4 text-footnote text-label">
              <p>
                <span className="text-label-2">Previous visits</span>{" "}
                <span className="tnum font-medium">
                  {patient.priorRecord.previousVisits}
                </span>
                <span className="ml-2 text-label-3">
                  · updated{" "}
                  {Math.round(patient.priorRecord.lastUpdatedMinutesAgo / 1440)} days ago
                </span>
              </p>
              <p>
                <span className="text-label-2">Conditions</span>{" "}
                {patient.priorRecord.conditions.join(", ") || "none recorded"}
              </p>
              <p>
                <span className="text-label-2">Medications</span>{" "}
                {patient.priorRecord.medications.join(", ") || "none recorded"}
              </p>
              <p>
                <span className="text-label-2">Allergies</span>{" "}
                {patient.priorRecord.allergies.join(", ") || "none recorded"}
              </p>
              {patient.priorRecord.carePlan && (
                <p className="rounded-ctl bg-tint-blue px-3 py-2 text-sys-blue">
                  <span className="font-semibold">Care plan on file — </span>
                  {patient.priorRecord.carePlan}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-card bg-elev2 p-4">
              <p className="text-footnote text-label-2">
                Nothing on file. First presentation at this hospital.
                {patient.completeness.missing.length > 1 && (
                  <>
                    {" "}
                    Also missing:{" "}
                    {patient.completeness.missing
                      .filter((m) => m !== "prior record")
                      .map((m) => m.replace("vital:", "observation "))
                      .join(", ")}
                    .
                  </>
                )}
              </p>
            </div>
          )}
        </section>

        {/* Vitals ------------------------------------------------------ */}
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <SectionLabel>
              {patient.vitalsStale
                ? `Vitals last taken ${formatDuration(patient.vitalsAgeMinutes)} ago`
                : `Vitals at simulated ${formatSimTime(state.simMinutes)}`}
            </SectionLabel>
            <span
              className={cx(
                "tnum -mt-1 text-footnote font-semibold",
                patient.newsBand === "high"
                  ? "text-sys-red"
                  : patient.newsBand === "medium"
                    ? "text-sys-orange"
                    : "text-label-2",
              )}
            >
              {patient.ewsChart} {patient.news}
            </span>
          </div>
          {patient.ageBand !== "adult" && (
            <div className="mb-2.5 rounded-ctl bg-tint-indigo px-3 py-2.5">
              <p className="text-caption font-semibold text-sys-indigo">
                Scored on the {patient.ewsChart} chart
              </p>
              <p className="mt-1 text-footnote leading-[17px] text-label">
                These same observations score{" "}
                <span className="tnum font-semibold">{patient.adultChartNews}</span>{" "}
                on the adult chart and{" "}
                <span className="tnum font-semibold">{patient.news}</span>{" "}
                on the age-appropriate one.{" "}
                {patient.adultChartNews > patient.news
                  ? "The adult chart over-reads age-normal physiology here — the kind of false alarm that teaches staff to ignore paediatric warnings."
                  : patient.adultChartNews < patient.news
                    ? "The adult chart UNDER-reads this patient. A blunted febrile response and a hypertensive baseline mean genuine deterioration can score close to zero on adult thresholds."
                    : "They agree on this particular set of observations, but the thresholds behind them differ."}
              </p>
            </div>
          )}

          {patient.completeness.zeroHistory && (
            <div className="mb-2.5 rounded-ctl bg-tint-indigo px-3 py-2.5">
              <p className="text-caption font-semibold text-sys-indigo">
                First presentation — no record on file
              </p>
              <p className="mt-1 text-footnote leading-[17px] text-label">
                Nothing is known about this patient beyond what is observed now:
                no past conditions, no medications, no allergies. Missing history
                raises this patient&apos;s urgency rather than lowering it —
                absence of information is not evidence of wellness.
              </p>
            </div>
          )}

          {patient.vitalsStale && (
            <div className="mb-2.5 rounded-ctl bg-tint-orange px-3 py-2.5">
              <p className="text-caption font-semibold text-st-escalated">
                Observations are {formatDuration(patient.vitalsAgeMinutes)} old
              </p>
              <p className="mt-1 text-footnote leading-[17px] text-label">
                Nobody has re-measured this patient. Every number below is frozen
                at its last reading, so the urgency score is running on stale
                data and the physiology term cannot rise no matter what is
                actually happening. This is the failure mode continuous
                re-scoring cannot engineer its way out of — it needs the
                observation to be taken.
              </p>
            </div>
          )}
          <div className="grid grid-cols-5 gap-2">
            {VITAL_META.map((m) => (
              <VitalCell
                key={m.key}
                label={m.label}
                unit={m.unit}
                arrival={patient.arrivalVitals[m.key]}
                current={patient.currentVitals[m.key]}
                points={contrib[m.key]}
                worse={m.worse}
              />
            ))}
          </div>
        </section>

        {/* Model assessment -------------------------------------------- */}
        <Group
          label="Model assessment"
          right={
            <div className="flex items-center gap-1.5">
              {patient.ai && (
                <Pill tone={patient.ai.source === "llm" ? "green" : "orange"}>
                  {patient.ai.source === "llm"
                    ? `${patient.ai.model} · ${patient.ai.latencyMs}ms`
                    : "rule-based fallback"}
                </Pill>
              )}
              <Button
                size="sm"
                tone="ghost"
                disabled={busy || patient.scoring}
                onClick={onRescore}
              >
                {patient.scoring ? "scoring…" : "Re-score"}
              </Button>
            </div>
          }
        >
          {patient.ai ? (
            <>
              <div className="flex items-start gap-3">
                <AcuityBadge level={patient.ai.acuity_level} />
                <div className="min-w-0 flex-1">
                  <p className="text-footnote leading-[18px] text-label">
                    {patient.ai.rationale}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="text-caption2 font-medium uppercase tracking-[0.05em] text-label-3">
                      Confidence
                    </span>
                    <div className="w-24">
                      <Meter
                        value={patient.ai.confidence}
                        tone={patient.ai.confidence < 0.5 ? "orange" : "blue"}
                      />
                    </div>
                    <span className="tnum text-caption font-medium text-label-2">
                      {(patient.ai.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              {patient.ai.risk_factors.filter((f) => f !== "none").length > 0 && (
                <div className="mt-3">
                  <p className="text-caption2 font-medium uppercase tracking-[0.05em] text-label-3">
                    Time-critical risks identified
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {patient.ai.risk_factors
                      .filter((f) => f !== "none")
                      .map((f) => (
                        <Pill key={f} tone="red" title={`Adds ${RISK_FACTOR_WEIGHT[f]} urgency points`}>
                          {RISK_FACTOR_LABEL[f]} +{RISK_FACTOR_WEIGHT[f]}
                        </Pill>
                      ))}
                  </div>
                  <p className="mt-1.5 text-caption2 leading-[15px] text-label-3">
                    Only the highest-weighted risk is counted, so listing more
                    cannot inflate a patient. These come from the model reading
                    the narrative — an ESI-3 with an airway risk and an ESI-3
                    with a kidney stone are the same acuity and very different
                    problems.
                  </p>
                </div>
              )}

              {patient.ai.atypical_presentation_flag && (
                <div className="mt-3 rounded-ctl bg-tint-red px-3 py-2.5">
                  <p className="text-caption font-semibold text-sys-red">
                    Atypical presentation flag
                  </p>
                  <p className="mt-1 text-footnote leading-[17px] text-label">
                    {patient.ai.atypical_reason ??
                      "The model judged this a possible atypical presentation of a serious condition."}{" "}
                    Time escalation for this patient runs at{" "}
                    {state.constants.atypicalRateMultiplier}× the normal rate.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-footnote text-label-2">
              {patient.scoring
                ? "Waiting for the local model…"
                : (patient.scoringError ?? "Not yet scored.")}
            </p>
          )}
        </Group>

        {/* Urgency ------------------------------------------------------ */}
        <Group label="Current urgency">
          <div className="mb-3 flex items-end justify-between">
            <div className="flex items-baseline gap-2">
              <span className={cx("tnum display text-title1 font-semibold", s.text)}>
                {patient.urgency.toFixed(1)}
              </span>
              <Pill
                tone={
                  patient.status === "critical"
                    ? "red"
                    : patient.status === "escalated"
                      ? "orange"
                      : patient.status === "watch"
                        ? "yellow"
                        : "green"
                }
              >
                {s.label}
              </Pill>
            </div>
            <span className="tnum text-caption text-label-3">
              at arrival {patient.urgencyAtArrival}
            </span>
          </div>

          <dl className="space-y-1.5">
            {[
              {
                label: `Base — ESI ${patient.effectiveAcuity}`,
                value: b.base,
                note: "20 × (6 − acuity)",
              },
              {
                label: `Wait pressure — ${formatDuration(patient.waitMinutes)}`,
                value: b.waitPressure,
                note: `${b.escalationRatePerMin}/min${
                  b.waitPressure >= state.constants.maxWaitPressure ? " (capped)" : ""
                }`,
              },
              {
                label: "Atypical-presentation boost",
                value: b.atypicalBoost,
                note: b.atypicalBoost ? "flagged by the model" : "not flagged",
              },
              {
                label: "Precautionary uplift (safety margin)",
                value: b.precautionaryUplift,
                note:
                  b.precautionaryUplift > 0
                    ? "escalating under uncertainty — see below"
                    : "confident, complete picture",
              },
              {
                label: "Model risk factors",
                value: b.riskFactorBoost,
                note:
                  patient.ai?.risk_factors.filter((f) => f !== "none").length
                    ? patient.ai.risk_factors
                        .filter((f) => f !== "none")
                        .map((f) => RISK_FACTOR_LABEL[f])
                        .join(", ")
                    : "none identified",
              },
              {
                label: "Ambient-sensing boost",
                value: b.ambientBoost,
                note: patient.ambient ? patient.ambient.reason : "no ambient flag",
              },
              {
                label: `Physiology — NEWS ${patient.news}`,
                value: b.physiologyPressure,
                note: `${state.constants.physiologyWeight} × NEWS, from current vitals`,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline gap-2 text-footnote">
                <dt className="min-w-0 flex-1 truncate text-label-2" title={row.note}>
                  {row.label}
                  <span className="ml-1.5 text-label-3">{row.note}</span>
                </dt>
                <dd
                  className={cx(
                    "tnum w-12 shrink-0 text-right font-medium",
                    row.value > 0 ? "text-label" : "text-label-3",
                  )}
                >
                  {row.value > 0 ? "+" : ""}
                  {row.value}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline gap-2 border-t border-sep pt-1.5 text-footnote">
              <dt className="flex-1 font-medium text-label">Total</dt>
              <dd className={cx("tnum w-12 text-right font-semibold", s.text)}>
                {b.total}
              </dd>
            </div>
          </dl>

          {b.precautionaryUplift > 0 && (
            <div className="mt-3 rounded-ctl bg-tint-orange px-3 py-2.5">
              <p className="text-caption font-semibold text-st-escalated">
                Escalated because the system is uncertain (+{b.precautionaryUplift})
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {precautionaryUplift({
                  acuity: patient.effectiveAcuity,
                  waitMinutes: patient.waitMinutes,
                  atypical: patient.ai?.atypical_presentation_flag ?? false,
                  ambient: patient.ambient !== null,
                  vitals: patient.currentVitals,
                  age: patient.age,
                  ageBand: patient.ageBand,
                  confidence: patient.ai?.confidence,
                  completeness: patient.completeness,
                }).reasons.map((r) => (
                  <li key={r} className="text-footnote leading-[17px] text-label">
                    · {r}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-caption2 leading-[15px] text-label-2">
                Under-triage and over-triage do not cost the same. This term is
                one-directional by construction: nothing in the model can lower a
                score because information is missing.
              </p>
            </div>
          )}

          {patient.ai?.missing_information && (
            <p className="mt-2 text-caption leading-[16px] text-label-2">
              <span className="font-medium text-label">Model asked for:</span>{" "}
              {patient.ai.missing_information}
            </p>
          )}

          <div className="mt-4 h-36">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trace} margin={{ top: 6, right: 6, bottom: 0, left: -26 }}>
                <defs>
                  <linearGradient id="urgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={t.red} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={t.red} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fill: t.label, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v: number) => `${Math.round(v / 60)}h`}
                />
                <YAxis
                  domain={[0, state.constants.urgencyMax]}
                  tick={{ fill: t.label, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  cursor={{ stroke: t.axis, strokeWidth: 1 }}
                  contentStyle={CHART_TOOLTIP}
                  labelFormatter={(v) => `after ${formatDuration(Number(v))} of waiting`}
                  formatter={(value: number, name: string) => [
                    value,
                    name === "urgency" ? "urgency" : "NEWS",
                  ]}
                />
                <ReferenceLine
                  y={state.constants.escalationThreshold}
                  stroke={t.orange}
                  strokeDasharray="4 4"
                  label={{
                    value: "escalation",
                    fill: t.orange,
                    fontSize: 9,
                    position: "insideTopRight",
                  }}
                />
                <ReferenceLine
                  x={patient.waitMinutes}
                  stroke={t.blue}
                  strokeDasharray="3 3"
                  label={{ value: "now", fill: t.blue, fontSize: 9, position: "top" }}
                />
                <Area
                  type="monotone"
                  dataKey="urgency"
                  stroke={t.red}
                  strokeWidth={2}
                  fill="url(#urgGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-caption2 leading-[15px] text-label-3">
            Projected urgency across this patient&apos;s wait, holding the current acuity
            fixed. The blue line is now.
            {patient.escalationCrossedAtMinutes !== null && (
              <>
                {" "}
                Crossed the escalation threshold at{" "}
                <span className="font-semibold text-sys-orange">
                  +{formatDuration(patient.escalationCrossedAtMinutes)}
                </span>{" "}
                into the wait.
              </>
            )}
          </p>
        </Group>

        {/* Nurse review ------------------------------------------------- */}
        <Group label="Nurse review">
          <OverrideForm
            patient={patient}
            busy={busy}
            onOverride={onOverride}
            onAccept={onAccept}
          />

          {overrides.length > 0 && (
            <div className="mt-3.5 space-y-2 border-t border-sep pt-3">
              {overrides.map((o) => (
                <div key={o.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={o.direction === "downgrade" ? "orange" : "blue"}>
                      {o.direction} ESI {o.fromAcuity} → {o.toAcuity}
                    </Pill>
                    <span className="text-caption text-label-3">
                      {o.nurse} · {formatSimTime(o.atSimMinutes)}
                      {o.seeded && " · seeded"}
                    </span>
                  </div>
                  <p className="mt-1 text-footnote italic leading-[17px] text-label-2">
                    “{o.reason}”
                  </p>
                </div>
              ))}
            </div>
          )}
        </Group>

        {/* Teaching note ------------------------------------------------ */}
        {patient.teachingNote && (
          <Group label="Demo note — synthetic case design" tone="indigo">
            <p className="text-footnote leading-[18px] text-label">
              {patient.teachingNote}
            </p>
          </Group>
        )}
      </div>
    </aside>
  );
}
