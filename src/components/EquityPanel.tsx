"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SEVERITY_MATCH_NEWS, Z_THRESHOLD } from "@/lib/equity";
import { formatSimTime } from "@/lib/clock";
import type { EquityReport } from "@/lib/types";
import {
  Card,
  Empty,
  Pill,
  SectionLabel,
  cx,
  CHART_TOOLTIP,
  CHART,
} from "./ui";

const METRIC_LABEL: Record<string, string> = {
  final_acuity: "Mean assigned acuity",
  downgrade_rate: "Nurse downgrade rate",
  severity_matched_acuity: `Severity-matched acuity (NEWS ≥ ${SEVERITY_MATCH_NEWS})`,
};

const TH = "py-2 text-caption font-medium text-label-2";

export function EquityPanel({
  equity,
  highlightTag,
}: {
  equity: EquityReport;
  highlightTag: string;
}) {
  const t = CHART;
  const notable = equity.findings.filter((f) => f.notable);

  return (
    <Card
      title="Override audit"
      subtitle={
        <>
          Audit only — nothing here changes any individual patient&apos;s score,
          urgency, or queue position. No ethnicity, community, region, language
          or payer is recorded anywhere in this system, so none can be counted
          here. Cohort n = {equity.cohortSize}; {equity.testsRun} comparisons run,
          corrected for false discovery.
        </>
      }
      right={
        <Pill tone={notable.length ? "red" : "green"}>
          {notable.length
            ? `${notable.length} notable gap${notable.length === 1 ? "" : "s"}`
            : "no notable gaps"}
        </Pill>
      }
    >
      <div className="space-y-5">
        {/* Findings ---------------------------------------------------- */}
        <div className="space-y-2">
          {equity.findings.length === 0 && (
            <Empty>
              No group differed from the rest of the cohort by |z| ≥ 1.5 on any
              audited metric.
            </Empty>
          )}
          {equity.findings.map((f) => (
            <div
              key={`${f.metric}-${f.tag}`}
              className={cx(
                "rounded-card px-3.5 py-3",
                f.notable ? "bg-tint-red" : "glass-soft",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={f.notable ? "red" : "gray"}>
                  {f.notable ? "Notable" : "below threshold"}
                </Pill>
                <span className="text-footnote font-semibold text-label">
                  {METRIC_LABEL[f.metric]}
                </span>
                <span className="tnum text-caption text-label-3">
                  {f.groupValue} vs {f.comparisonValue} · z = {f.z} · p ={" "}
                  {f.pValue < 0.001 ? "<0.001" : f.pValue.toFixed(3)}
                </span>
              </div>
              <p className="mt-1.5 text-footnote leading-[18px] text-label-2">
                {f.message}
              </p>
            </div>
          ))}
        </div>

        {/* Overrides that contradict the patient's own physiology --------- */}
        {equity.contradictions.length > 0 && (
          <div>
            <SectionLabel>
              Downgrades contradicting the patient&apos;s own vitals
            </SectionLabel>
            <ol className="overflow-hidden rounded-card">
              {equity.contradictions.map((c, i) => (
                <li
                  key={c.overrideId}
                  className={cx(
                    "bg-tint-red px-3.5 py-2.5",
                    i !== equity.contradictions.length - 1 && "border-b border-sep",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-footnote font-semibold text-label">
                      {c.patientName}
                    </span>
                    <Pill tone="red">
                      ESI {c.fromAcuity} → {c.toAcuity}
                    </Pill>
                    <span className="tnum text-caption text-label-2">
                      NEWS {c.newsAtOverride} at {formatSimTime(c.atSimMinutes)}
                      {c.newsNow !== c.newsAtOverride && ` · NEWS ${c.newsNow} now`}
                    </span>
                    <span className="text-caption text-label-3">{c.nurse}</span>
                  </div>
                  <p className="mt-1 text-footnote italic leading-[17px] text-label-2">
                    “{c.reason}”
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-caption leading-[16px] text-label-3">
              Each of these deprioritised a patient whose own NEWS was at or above{" "}
              {equity.contradictionNewsThreshold}. This check uses no grouping
              variable at all — every patient is compared only against themselves,
              so it needs to know nothing about who they are.
            </p>
          </div>
        )}

        {/* Chart ------------------------------------------------------- */}
        <div>
          <SectionLabel>Nurse downgrade rate by arrival route</SectionLabel>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={equity.groups}
                margin={{ top: 6, right: 8, bottom: 0, left: -24 }}
                barCategoryGap="34%"
              >
                <CartesianGrid stroke={t.grid} vertical={false} />
                <XAxis
                  dataKey="tag"
                  tick={{ fill: t.label, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: t.label, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  cursor={{ fill: t.grid }}
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value: number) => [
                    `${Math.round(value * 100)}%`,
                    "downgraded",
                  ]}
                />
                <Bar dataKey="downgradeRate" radius={[5, 5, 5, 5]} maxBarSize={38}>
                  {equity.groups.map((g) => (
                    <Cell key={g.tag} fill={g.tag === highlightTag ? t.red : t.gray} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table ------------------------------------------------------- */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-sep text-left">
                <th className={cx(TH, "pr-2")}>Arrival</th>
                <th className={cx(TH, "px-1.5 text-right")}>n</th>
                <th
                  className={cx(TH, "px-1.5 text-right")}
                  title="Mean acuity the model proposed, before any override"
                >
                  AI
                </th>
                <th
                  className={cx(TH, "px-1.5 text-right")}
                  title="Mean acuity in force after nurse overrides"
                >
                  Final
                </th>
                <th
                  className={cx(TH, "px-1.5 text-right")}
                  title="Mean National Early Warning Score — the objective severity check"
                >
                  NEWS
                </th>
                <th className={cx(TH, "px-1.5 text-right")}>Overrides</th>
                <th className={cx(TH, "px-1.5 text-right")}>Down</th>
                <th
                  className={cx(TH, "px-1.5 text-right")}
                  title={`Mean final acuity among patients with NEWS ≥ ${SEVERITY_MATCH_NEWS}`}
                >
                  Matched
                </th>
              </tr>
            </thead>
            <tbody>
              {equity.groups.map((g, i) => (
                <tr
                  key={g.tag}
                  className={cx(
                    i !== equity.groups.length - 1 && "border-b border-sep",
                    g.tag === highlightTag && "bg-tint-red",
                  )}
                >
                  <td className="py-2 pr-2 text-footnote font-medium text-label">
                    {g.tag}
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote text-label-2">
                    {g.n}
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote text-label-2">
                    {g.meanAiAcuity ?? "–"}
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote font-semibold text-label">
                    {g.meanFinalAcuity}
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote text-label-2">
                    {g.meanNews}
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote text-label-2">
                    {g.overrides}/{g.n}
                  </td>
                  <td
                    className={cx(
                      "tnum px-1.5 py-2 text-right text-footnote font-semibold",
                      g.downgradeRate >= 0.5 ? "text-sys-red" : "text-label-2",
                    )}
                  >
                    {Math.round(g.downgradeRate * 100)}%
                  </td>
                  <td className="tnum px-1.5 py-2 text-right text-footnote text-label-2">
                    {g.meanFinalAcuityHighNews ?? "–"}
                    <span className="ml-0.5 text-label-3">({g.nHighNews})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="rounded-card glass-soft px-3.5 py-3 text-caption leading-[16px] text-label-2">
          <span className="font-semibold text-label">Method &amp; limits.</span>{" "}
          Arrival route is an encounter fact, not an attribute of the person, and
          it is a documented anchor on triage judgement: a patient who walks in
          gets under-triaged relative to a clinically identical patient delivered
          by ambulance. Each route is compared against the pooled remainder of the
          cohort with a two-sample z-test (pooled SD for means, pooled proportion
          for rates); |z| ≥ {Z_THRESHOLD} is reported as notable. The
          severity-matched column restricts to patients whose measured physiology
          is comparably abnormal (NEWS ≥ {SEVERITY_MATCH_NEWS}), so a surviving
          gap cannot be explained by one group simply being less sick. On an{" "}
          {equity.cohortSize}-patient synthetic cohort these tests demonstrate the{" "}
          <em>method</em> only — groups of 3–10 are far too small to support a
          claim about anything real, and no multiple-comparison correction is
          applied. The contradiction list above needs none of this: it compares
          each patient only against themselves, which is why it fires on the first
          unsafe override rather than waiting for a pattern to accumulate.
        </p>
      </div>
    </Card>
  );
}
