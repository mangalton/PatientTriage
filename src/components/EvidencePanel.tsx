"use client";

import type { AnalysisReport } from "@/lib/analysis";
import { Card, Empty, Meter, Pill, SectionLabel, cx } from "./ui";

/**
 * The self-evaluation panel.
 *
 * This exists because the two strongest attacks on this project are "you tuned
 * those constants until the demo looked good" and "your dynamic system just
 * reproduces the static ordering it claims to fix". Both are fair, and both are
 * measurable, so they are measured here and shown in the product rather than
 * argued away in a README.
 */
export function EvidencePanel({ analysis }: { analysis: AnalysisReport }) {
  const sb = analysis.staticBaseline;

  // How far the live queue has departed from doing nothing at all.
  const divergence = Math.max(0, Math.min(1, 1 - sb.spearman));
  const verdict =
    sb.spearman >= 0.97
      ? {
          tone: "red" as const,
          text: "Not earning its keep",
          detail:
            "The live queue is nearly identical to a static intake ordering. On this cohort the dynamic layer is not changing decisions.",
        }
      : sb.spearman >= 0.9
        ? {
            tone: "orange" as const,
            text: "Marginal",
            detail:
              "The dynamic layer moves the queue, but most patients would sit in the same place under a static score.",
          }
        : {
            tone: "green" as const,
            text: "Changing decisions",
            detail:
              "The live ordering departs substantially from what a static intake score would produce.",
          };

  return (
    <Card
      title="Model evidence"
      subtitle="Measured against this cohort, right now. Every constant in the urgency model is invented; this panel reports how much each one actually matters."
      right={<Pill tone={verdict.tone}>{verdict.text}</Pill>}
    >
      <div className="space-y-6">
        {/* --- Does the dynamic layer earn its keep? ------------------- */}
        <section>
          <SectionLabel>Versus doing nothing</SectionLabel>
          <div className="rounded-card bg-fill p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="tnum display-tight text-title2 font-semibold text-label">
                  ρ = {sb.spearman.toFixed(3)}
                </div>
                <p className="mt-1 text-caption text-label-2">
                  rank correlation with a static intake ordering
                </p>
              </div>
              <div className="text-right">
                <div className="tnum display-tight text-title3 font-semibold text-label">
                  {sb.rowsMoved}/{sb.cohortSize}
                </div>
                <p className="mt-1 text-caption text-label-2">
                  rows in a different place
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Meter
                value={divergence}
                max={0.4}
                tone={
                  sb.spearman >= 0.97
                    ? "critical"
                    : sb.spearman >= 0.9
                      ? "escalated"
                      : "stable"
                }
              />
            </div>
            <p className="mt-3 text-footnote leading-[18px] text-label-2">
              {verdict.detail}{" "}
              <span className="font-medium text-label">
                {sb.substantiallyMoved} patient
                {sb.substantiallyMoved === 1 ? " is" : "s are"} at least three
                places from where a static score would put them.
              </span>
            </p>
            <p className="mt-2 text-caption2 leading-[15px] text-label-3">
              Baseline is intake acuity with arrival-time tie-breaking — what the
              department would do with no model at all. Ties must be broken FIFO:
              breaking them in live-queue order correlates the ordering with
              itself and inflates ρ to a meaningless ~0.99.
            </p>
          </div>
        </section>

        {/* --- Ablation ------------------------------------------------ */}
        <section>
          <SectionLabel>Ablation — remove one term, re-rank</SectionLabel>
          {analysis.ablations.length === 0 ? (
            <Empty>Not enough patients to ablate.</Empty>
          ) : (
            <ol className="overflow-hidden rounded-card">
              {analysis.ablations.map((a, i) => (
                <li
                  key={a.key}
                  className={cx(
                    "bg-fill px-3.5 py-3",
                    i !== analysis.ablations.length - 1 && "border-b border-sep",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-footnote font-semibold text-label">
                      {a.label}
                    </span>
                    <span className="tnum text-caption text-label-2">
                      ρ {a.spearman.toFixed(3)} · {a.rowsMoved}/{a.cohortSize} moved
                      · {a.topFiveRetained}/5 top kept
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2.5">
                    <div className="flex-1">
                      <Meter
                        value={Math.max(0, 1 - a.spearman)}
                        max={0.4}
                        tone={
                          a.spearman >= 0.99
                            ? "watch"
                            : a.spearman >= 0.95
                              ? "escalated"
                              : "stable"
                        }
                      />
                    </div>
                    <span className="tnum w-24 text-right text-caption text-label-3">
                      {a.meanPoints} pts · {a.shareOfTotal}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-caption leading-[16px] text-label-3">
                    {a.detail}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-caption2 leading-[15px] text-label-3">
            Sorted by impact: the term at the top changes the queue most when
            removed. A term contributing many points but barely moving the
            ordering is inflating every patient equally and deciding nothing.
          </p>
        </section>

        {/* --- Sensitivity --------------------------------------------- */}
        <section>
          <SectionLabel>Sensitivity — scale one constant ±50%</SectionLabel>
          {analysis.sensitivity.length === 0 ? (
            <Empty>Not enough patients to sweep.</Empty>
          ) : (
            <div className="overflow-hidden rounded-card">
              {analysis.sensitivity.map((row, i) => (
                <div
                  key={row.key}
                  className={cx(
                    "flex items-center gap-3 bg-fill px-3.5 py-2.5",
                    i !== analysis.sensitivity.length - 1 && "border-b border-sep",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-footnote text-label">
                    {row.label}
                  </span>
                  <span className="tnum text-caption text-label-3">
                    ρ ≥ {row.worstSpearman.toFixed(3)}
                  </span>
                  <Pill
                    tone={
                      row.verdict === "sensitive"
                        ? "red"
                        : row.verdict === "moderate"
                          ? "orange"
                          : "gray"
                    }
                  >
                    {row.verdict}
                  </Pill>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-caption2 leading-[15px] text-label-3">
            A constant marked <span className="font-medium">insensitive</span> can
            be wrong by half and the queue barely notices — being arbitrary there
            costs little. One marked{" "}
            <span className="font-medium text-st-critical">sensitive</span> is a
            stated risk: it is invented, and the ordering depends on it. Those are
            the numbers that would need deriving from outcome data before this
            went anywhere near a patient.
          </p>
        </section>
      </div>
    </Card>
  );
}
