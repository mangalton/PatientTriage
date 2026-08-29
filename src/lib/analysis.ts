/**
 * Self-evaluation: ablation and sensitivity analysis over the live cohort.
 *
 * WHY THIS EXISTS.
 *   Every constant in the urgency model is invented. That is unavoidable
 *   without outcome data, but it is only defensible if we say *how much each
 *   invented number actually matters*. This module measures exactly that, and
 *   the dashboard renders it, so the most obvious attack on the project —
 *   "you tuned those numbers until the demo looked good" — is answered with
 *   figures rather than with a disclaimer.
 *
 *   It also answers the sharper question: does the dynamic layer earn its
 *   keep, or does this system just reproduce the static intake ordering it
 *   claims to fix? `staticBaseline` reports that number directly, and it is
 *   deliberately the first thing on the panel even when it is unflattering.
 *
 * METHOD.
 *   - ABLATION: zero one term, re-rank the same patients, and measure how far
 *     the ordering moves (Spearman rho, rows displaced, top-5 retained).
 *   - SENSITIVITY: scale one constant by 0.5x and 1.5x, re-rank, measure. A
 *     constant the ordering barely responds to is defensible as arbitrary; one
 *     it responds to strongly is a stated risk.
 *   - STATIC BASELINE: rank by intake acuity with FIFO tie-breaking — what the
 *     department would do with no model at all.
 *
 * A NOTE ON TIE-BREAKING, because it bit us. Ranking by acuity alone leaves
 * large groups tied, and if those ties are broken in the order the live queue
 * happens to supply, you are correlating the ordering with itself and the
 * baseline looks 0.99 similar. Ties MUST be broken by arrival time — that is
 * what a real static triage queue does.
 */

import {
  DEFAULT_WEIGHTS,
  computeUrgency,
  type UrgencyWeights,
} from "./urgency";
import type { AcuityLevel, PatientSnapshot, RiskFactor } from "./types";

export interface AblationRow {
  key: string;
  label: string;
  detail: string;
  /** Spearman rank correlation of the ablated ordering against the live one. */
  spearman: number;
  rowsMoved: number;
  cohortSize: number;
  topFiveRetained: number;
  /** Mean points this term contributes per patient. */
  meanPoints: number;
  /** That term's share of all urgency points in the cohort. */
  shareOfTotal: number;
}

export interface SensitivityRow {
  key: string;
  label: string;
  /** Lowest Spearman seen across the -50% / +50% sweep. */
  worstSpearman: number;
  maxRowsMoved: number;
  verdict: "insensitive" | "moderate" | "sensitive";
}

export interface StaticBaseline {
  /** Live ordering vs. intake-acuity-with-FIFO. 1.0 means we changed nothing. */
  spearman: number;
  rowsMoved: number;
  cohortSize: number;
  /** Patients whose position differs by 3 or more places. */
  substantiallyMoved: number;
}

export interface AnalysisReport {
  staticBaseline: StaticBaseline;
  ablations: AblationRow[];
  sensitivity: SensitivityRow[];
  cohortSize: number;
}

// ---------------------------------------------------------------------------
// Rank statistics
// ---------------------------------------------------------------------------

function spearman(a: string[], b: string[]): number {
  const n = a.length;
  if (n < 2) return 1;
  const ra = new Map(a.map((id, i) => [id, i]));
  const rb = new Map(b.map((id, i) => [id, i]));
  let d2 = 0;
  for (const [id, i] of ra) {
    const j = rb.get(id);
    if (j === undefined) continue;
    d2 += (i - j) ** 2;
  }
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 1000) / 1000;
}

function rowsMoved(a: string[], b: string[]): number {
  return b.reduce((n, id, i) => (a[i] === id ? n : n + 1), 0);
}

// ---------------------------------------------------------------------------
// Re-ranking
// ---------------------------------------------------------------------------

type Term =
  | "waitPressure"
  | "atypicalBoost"
  | "riskFactorBoost"
  | "ambientBoost"
  | "physiologyPressure";

function score(
  p: PatientSnapshot,
  weights: UrgencyWeights,
  drop?: Term,
): number {
  const b = computeUrgency(
    {
      acuity: p.effectiveAcuity,
      waitMinutes: p.waitMinutes,
      atypical: p.ai?.atypical_presentation_flag ?? false,
      ambient: p.ambient !== null,
      riskFactors: p.ai?.risk_factors ?? [],
      vitals: p.currentVitals,
    },
    weights,
  );
  return drop ? b.total - b[drop] : b.total;
}

function orderBy(
  patients: PatientSnapshot[],
  weights: UrgencyWeights,
  drop?: Term,
): string[] {
  return [...patients]
    .sort(
      (x, y) =>
        score(y, weights, drop) - score(x, weights, drop) ||
        x.arrivalSimMinutes - y.arrivalSimMinutes,
    )
    .map((p) => p.id);
}

const ABLATIONS: { key: Term; label: string; detail: string }[] = [
  {
    key: "waitPressure",
    label: "Time decay",
    detail:
      "The project's central claim. If removing it barely moves the queue, the dynamic layer is not earning its keep.",
  },
  {
    key: "physiologyPressure",
    label: "Physiology (NEWS)",
    detail:
      "Deterministic early-warning score from current observations. Not AI, and the strongest single signal.",
  },
  {
    key: "riskFactorBoost",
    label: "Model risk factors",
    detail:
      "Named time-critical risks the model read out of the narrative, applied as a floor. A small mean share is expected and correct: it contributes nothing to patients already prioritised properly, and everything to the ones whose acuity missed a red flag.",
  },
  {
    key: "atypicalBoost",
    label: "Atypical flag",
    detail:
      "Model's judgement that a mild-sounding complaint may mask a serious condition.",
  },
  {
    key: "ambientBoost",
    label: "Ambient sensing",
    detail: "Simulated waiting-room signal. Designed to nudge, never to decide.",
  },
];

// ---------------------------------------------------------------------------
// Sensitivity sweep
// ---------------------------------------------------------------------------

function scaleWeights(w: UrgencyWeights, key: string, f: number): UrgencyWeights {
  const next: UrgencyWeights = {
    ...w,
    basePerLevel: { ...w.basePerLevel },
    escalationRatePerMin: { ...w.escalationRatePerMin },
    riskFactorWeight: { ...w.riskFactorWeight },
    riskFactorFloor: { ...w.riskFactorFloor },
  };
  switch (key) {
    case "basePerLevel":
      for (const k of Object.keys(next.basePerLevel) as unknown as AcuityLevel[]) {
        next.basePerLevel[k] = w.basePerLevel[k] * f;
      }
      break;
    case "escalationRatePerMin":
      for (const k of Object.keys(
        next.escalationRatePerMin,
      ) as unknown as AcuityLevel[]) {
        next.escalationRatePerMin[k] = w.escalationRatePerMin[k] * f;
      }
      break;
    case "physiologyWeight":
      next.physiologyWeight = w.physiologyWeight * f;
      break;
    case "atypicalBoost":
      next.atypicalBoost = w.atypicalBoost * f;
      break;
    case "atypicalRateMultiplier":
      next.atypicalRateMultiplier = w.atypicalRateMultiplier * f;
      break;
    case "ambientBoost":
      next.ambientBoost = w.ambientBoost * f;
      break;
    case "riskFactorWeight":
      for (const k of Object.keys(next.riskFactorWeight) as RiskFactor[]) {
        next.riskFactorWeight[k] = w.riskFactorWeight[k] * f;
        next.riskFactorFloor[k] = w.riskFactorFloor[k] * f;
      }
      break;
    case "maxWaitPressure":
      next.maxWaitPressure = w.maxWaitPressure * f;
      break;
  }
  return next;
}

const SWEPT: { key: string; label: string }[] = [
  { key: "basePerLevel", label: "Base per ESI level" },
  { key: "escalationRatePerMin", label: "Time-decay rate" },
  { key: "physiologyWeight", label: "NEWS weight" },
  { key: "riskFactorWeight", label: "Risk-factor floors" },
  { key: "atypicalBoost", label: "Atypical boost" },
  { key: "atypicalRateMultiplier", label: "Atypical rate multiplier" },
  { key: "ambientBoost", label: "Ambient boost" },
  { key: "maxWaitPressure", label: "Wait-pressure cap" },
];

// ---------------------------------------------------------------------------

export function buildAnalysisReport(
  patients: PatientSnapshot[],
  weights: UrgencyWeights = DEFAULT_WEIGHTS,
): AnalysisReport {
  const n = patients.length;
  const empty: AnalysisReport = {
    staticBaseline: { spearman: 1, rowsMoved: 0, cohortSize: n, substantiallyMoved: 0 },
    ablations: [],
    sensitivity: [],
    cohortSize: n,
  };
  if (n < 3) return empty;

  const live = orderBy(patients, weights);

  // --- static baseline: intake acuity, FIFO within level ---
  const staticOrder = [...patients]
    .sort(
      (a, b) =>
        a.effectiveAcuity - b.effectiveAcuity ||
        a.arrivalSimMinutes - b.arrivalSimMinutes,
    )
    .map((p) => p.id);
  const livePos = new Map(live.map((id, i) => [id, i]));
  const substantiallyMoved = staticOrder.filter(
    (id, i) => Math.abs((livePos.get(id) ?? i) - i) >= 3,
  ).length;

  // --- ablations ---
  const totalPoints = patients.reduce((sum, p) => sum + p.urgency, 0) || 1;
  const ablations: AblationRow[] = ABLATIONS.map(({ key, label, detail }) => {
    const order = orderBy(patients, weights, key);
    const points = patients.reduce((sum, p) => sum + p.urgencyBreakdown[key], 0);
    return {
      key,
      label,
      detail,
      spearman: spearman(live, order),
      rowsMoved: rowsMoved(live, order),
      cohortSize: n,
      topFiveRetained: live
        .slice(0, 5)
        .filter((id) => order.slice(0, 5).includes(id)).length,
      meanPoints: Math.round((points / n) * 10) / 10,
      shareOfTotal: Math.round((points / totalPoints) * 1000) / 10,
    };
  }).sort((a, b) => a.spearman - b.spearman);

  // --- sensitivity ---
  const sensitivity: SensitivityRow[] = SWEPT.map(({ key, label }) => {
    let worst = 1;
    let moved = 0;
    for (const f of [0.5, 1.5]) {
      const order = orderBy(patients, scaleWeights(weights, key, f));
      worst = Math.min(worst, spearman(live, order));
      moved = Math.max(moved, rowsMoved(live, order));
    }
    const verdict: SensitivityRow["verdict"] =
      worst >= 0.97 ? "insensitive" : worst >= 0.9 ? "moderate" : "sensitive";
    return { key, label, worstSpearman: worst, maxRowsMoved: moved, verdict };
  }).sort((a, b) => a.worstSpearman - b.worstSpearman);

  return {
    staticBaseline: {
      spearman: spearman(live, staticOrder),
      rowsMoved: rowsMoved(live, staticOrder),
      cohortSize: n,
      substantiallyMoved,
    },
    ablations,
    sensitivity,
    cohortSize: n,
  };
}
