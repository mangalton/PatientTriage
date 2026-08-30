/**
 * Module 3 — Equity audit.
 *
 * AUDIT ONLY. Nothing in this file writes to a patient. It reads the cohort and
 * reports where the *system's own behaviour* is inconsistent. No individual
 * patient's acuity, urgency, or queue position is ever changed by anything
 * computed here.
 *
 * WHAT THIS AUDIT DOES NOT USE.
 *   This prototype records no ethnicity, community, region, religion, language,
 *   caste, or payer field — the data model has no such column, so no such column
 *   can be counted here. That is a deliberate constraint, not an oversight, and
 *   it is why the audit is built on two axes that require no profiling at all:
 *
 *   1. ARRIVAL ROUTE — an encounter fact ("how did this person get here"), not a
 *      attribute of the person. It is also a real and well-documented source of
 *      triage bias: a patient who walks in is systematically under-triaged
 *      relative to a clinically identical patient delivered by ambulance,
 *      because the mode of arrival anchors the assessor before they look.
 *
 *   2. SELF-CONTRADICTION — each patient compared only against THEMSELVES. A
 *      downgrade applied to someone whose own NEWS is climbing is unsafe whoever
 *      they are, and finding it needs no group, no tag, and no comparison to
 *      anyone else in the department.
 *
 *   The second axis is the stronger of the two and the one worth watching. It
 *   catches an unsafe override on the first patient it happens to, rather than
 *   waiting for a statistically detectable pattern to accumulate across a
 *   demographic group — by which point the harm has already been done many times.
 *
 * Caveat carried into the UI: this is an 18-patient synthetic cohort. A z-test
 * on groups of 3-10 is illustrative of the method, not evidence about anything.
 */

import { ARRIVAL_MODES } from "./types";
import { earlyWarningScore } from "./ews";
import { projectVitals } from "./urgency";
import type {
  ArrivalMode,
  EquityFinding,
  EquityGroupStat,
  EquityReport,
  OverrideContradiction,
  PatientSnapshot,
  OverrideRecord,
} from "./types";

/** |z| above this is reported as a notable gap (two-sided, α = 0.05). */
export const Z_THRESHOLD = 1.96;

/** NEWS at or above this counts as "physiologically comparable" for matching. */
export const SEVERITY_MATCH_NEWS = 3;

/**
 * A downgrade applied to a patient whose NEWS is at or above this is flagged as
 * contradicting their own measured physiology.
 */
export const CONTRADICTION_NEWS = 4;

/**
 * Two-sided p-value for a z statistic, via an Abramowitz & Stegun approximation
 * of the normal CDF. Accurate to ~1e-7, which is far beyond what an 18-patient
 * cohort deserves, but it costs nothing and makes the correction below honest.
 */
export function pFromZ(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return Math.min(1, Math.max(0, 1 - y));
}

/**
 * Benjamini-Hochberg step-up procedure, controlling the false discovery rate.
 *
 * WHY. This audit runs a comparison for every metric against every arrival
 * route — around fifteen tests. At alpha = 0.05 you expect roughly one
 * "significant" result by chance alone, so reporting raw p-values would mean
 * the panel confidently announces a finding on a quiet day. BH is the right
 * correction here rather than Bonferroni: the tests are positively correlated
 * (they share patients), and we would rather tolerate a few false positives
 * than miss a real disparity, which is the asymmetry that matters clinically.
 */
export function benjaminiHochberg(pValues: number[], q = 0.05): boolean[] {
  const n = pValues.length;
  const idx = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let cutoff = -1;
  for (let k = 0; k < n; k += 1) {
    if (idx[k].p <= ((k + 1) / n) * q) cutoff = k;
  }
  const keep = new Array<boolean>(n).fill(false);
  for (let k = 0; k <= cutoff; k += 1) keep[idx[k].i] = true;
  return keep;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Two-sample z for a difference of means, using the pooled standard deviation.
 * Returns 0 when either side is too small or has no spread — we would rather
 * report nothing than manufacture a significant-looking number.
 */
function zForMeans(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  const va = mean(a.map((x) => (x - ma) ** 2)) * (a.length / (a.length - 1));
  const vb = mean(b.map((x) => (x - mb) ** 2)) * (b.length / (b.length - 1));
  const pooled = Math.sqrt(
    ((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2),
  );
  if (pooled === 0) return 0;
  const se = pooled * Math.sqrt(1 / a.length + 1 / b.length);
  if (se === 0) return 0;
  return (ma - mb) / se;
}

/** Two-proportion z-test with a pooled proportion. */
function zForProportions(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  if (pooled === 0 || pooled === 1) return 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

const ROUTE_PHRASE: Record<ArrivalMode, string> = {
  "Walk-in": "walked in",
  Ambulance: "arrived by ambulance",
  Referred: "arrived on referral",
};

export function buildEquityReport(
  patients: PatientSnapshot[],
  overrides: OverrideRecord[],
  atSimMinutes: number,
): EquityReport {
  const byPatientOverride = new Map<string, OverrideRecord>();
  // Latest override wins.
  for (const o of overrides) byPatientOverride.set(o.patientId, o);

  const present = ARRIVAL_MODES.filter((m) =>
    patients.some((p) => p.arrivalMode === m),
  );

  const groups: EquityGroupStat[] = present.map((tag) => {
    const inGroup = patients.filter((p) => p.arrivalMode === tag);
    const groupOverrides = inGroup
      .map((p) => byPatientOverride.get(p.id))
      .filter((o): o is OverrideRecord => Boolean(o));
    const downgrades = groupOverrides.filter((o) => o.direction === "downgrade").length;
    const upgrades = groupOverrides.filter((o) => o.direction === "upgrade").length;
    const scored = inGroup.filter((p) => p.ai !== null);
    const highNews = inGroup.filter((p) => p.news >= SEVERITY_MATCH_NEWS);

    return {
      tag,
      n: inGroup.length,
      meanAiAcuity: scored.length
        ? round(mean(scored.map((p) => p.ai!.acuity_level)))
        : null,
      meanFinalAcuity: round(mean(inGroup.map((p) => p.effectiveAcuity))),
      meanNews: round(mean(inGroup.map((p) => p.news)), 1),
      overrides: groupOverrides.length,
      downgrades,
      upgrades,
      overrideRate: round(inGroup.length ? groupOverrides.length / inGroup.length : 0),
      downgradeRate: round(inGroup.length ? downgrades / inGroup.length : 0),
      meanFinalAcuityHighNews: highNews.length
        ? round(mean(highNews.map((p) => p.effectiveAcuity)))
        : null,
      nHighNews: highNews.length,
    };
  });

  const findings: EquityFinding[] = [];

  for (const tag of present) {
    const inGroup = patients.filter((p) => p.arrivalMode === tag);
    const rest = patients.filter((p) => p.arrivalMode !== tag);
    if (inGroup.length < 2 || rest.length < 2) continue;
    const phrase = ROUTE_PHRASE[tag];

    // 1. Mean final acuity. Higher ESI number = lower priority.
    const zAcuity = zForMeans(
      inGroup.map((p) => p.effectiveAcuity),
      rest.map((p) => p.effectiveAcuity),
    );
    {
      const groupValue = round(mean(inGroup.map((p) => p.effectiveAcuity)));
      const comparisonValue = round(mean(rest.map((p) => p.effectiveAcuity)));
      findings.push({
        metric: "final_acuity",
        tag,
        groupValue,
        comparisonValue,
        z: round(zAcuity),
        pValue: 1,
        notable: Math.abs(zAcuity) >= Z_THRESHOLD,
        message:
          zAcuity > 0
            ? `Patients who ${phrase} carry a mean acuity of ${groupValue} vs ${comparisonValue} for the rest of the cohort — a *less* urgent assignment on average.`
            : `Patients who ${phrase} carry a mean acuity of ${groupValue} vs ${comparisonValue} for the rest of the cohort — a *more* urgent assignment on average.`,
      });
    }

    // 2. Downgrade rate in the human override layer.
    const groupDown = inGroup.filter(
      (p) => byPatientOverride.get(p.id)?.direction === "downgrade",
    ).length;
    const restDown = rest.filter(
      (p) => byPatientOverride.get(p.id)?.direction === "downgrade",
    ).length;
    const zDown = zForProportions(groupDown, inGroup.length, restDown, rest.length);
    {
      findings.push({
        metric: "downgrade_rate",
        tag,
        groupValue: round(groupDown / inGroup.length),
        comparisonValue: round(restDown / rest.length),
        z: round(zDown),
        pValue: 1,
        notable: Math.abs(zDown) >= Z_THRESHOLD,
        message:
          zDown > 0
            ? `${groupDown} of ${inGroup.length} patients who ${phrase} were downgraded by a nurse override, vs ${restDown} of ${rest.length} who did not.`
            : `Patients who ${phrase} were downgraded less often than the rest of the cohort (${groupDown}/${inGroup.length} vs ${restDown}/${rest.length}).`,
      });
    }

    // 3. Severity-matched acuity — the finding that is hard to explain away.
    const groupHigh = inGroup.filter((p) => p.news >= SEVERITY_MATCH_NEWS);
    const restHigh = rest.filter((p) => p.news >= SEVERITY_MATCH_NEWS);
    if (groupHigh.length >= 2 && restHigh.length >= 2) {
      const zMatched = zForMeans(
        groupHigh.map((p) => p.effectiveAcuity),
        restHigh.map((p) => p.effectiveAcuity),
      );
      {
        const groupValue = round(mean(groupHigh.map((p) => p.effectiveAcuity)));
        const comparisonValue = round(mean(restHigh.map((p) => p.effectiveAcuity)));
        findings.push({
          metric: "severity_matched_acuity",
          tag,
          groupValue,
          comparisonValue,
          z: round(zMatched),
          pValue: 1,
          notable: Math.abs(zMatched) >= Z_THRESHOLD,
          message:
            zMatched > 0
              ? `Among patients with comparably abnormal physiology (NEWS ≥ ${SEVERITY_MATCH_NEWS}), those who ${phrase} still average ${groupValue} vs ${comparisonValue}. The gap survives severity matching, so "they were less sick" does not explain it.`
              : `Among patients with NEWS ≥ ${SEVERITY_MATCH_NEWS}, those who ${phrase} average ${groupValue} vs ${comparisonValue}.`,
        });
      }
    }
  }

  // Multiple comparisons.
  //
  // Critically, the correction is applied to EVERY comparison performed, not
  // just the ones that looked interesting. Screening on |z| first and then
  // correcting the survivors is a common and badly wrong move: it shrinks the
  // denominator to exactly the tests most likely to be false positives, and the
  // correction stops doing anything. Every test enters the family; the display
  // filter comes afterwards.
  const testsRun = findings.length;
  const pValues = findings.map((f) => pFromZ(f.z));
  const survives = benjaminiHochberg(pValues, 0.05);
  findings.forEach((f, i) => {
    f.pValue = Math.round(pValues[i] * 10000) / 10000;
    f.notable = survives[i];
  });

  // Only now drop the comparisons too small to be worth showing — but a finding
  // that survived the correction is always shown, whatever its raw z.
  const reported = findings.filter((f) => f.notable || Math.abs(f.z) >= 1.5);
  findings.length = 0;
  findings.push(...reported);

  // Order by how defensible the finding is, not by raw |z|. A gap in *mean*
  // acuity is confounded — if one route genuinely brings sicker patients, a
  // difference is correct triage, not bias. The severity-matched comparison
  // controls for that, and the downgrade-rate test is about the human layer
  // specifically, so both outrank the raw comparison however large its z.
  const METRIC_RANK: Record<EquityFinding["metric"], number> = {
    severity_matched_acuity: 0,
    downgrade_rate: 1,
    final_acuity: 2,
  };
  findings.sort(
    (a, b) =>
      METRIC_RANK[a.metric] - METRIC_RANK[b.metric] || Math.abs(b.z) - Math.abs(a.z),
  );

  // -------------------------------------------------------------------------
  // Self-contradiction: a downgrade applied to a patient whose own physiology
  // was already abnormal. No grouping variable involved — each patient is
  // measured only against themselves.
  // -------------------------------------------------------------------------
  const byId = new Map(patients.map((p) => [p.id, p]));
  const contradictions: OverrideContradiction[] = [];

  for (const o of overrides) {
    if (o.direction !== "downgrade") continue;
    const p = byId.get(o.patientId);
    if (!p) continue;

    const waitAtOverride = Math.max(0, o.atSimMinutes - p.arrivalSimMinutes);
    const newsAtOverride = earlyWarningScore(
      projectVitals(p.arrivalVitals, p.trajectory, waitAtOverride, p.id).vitals,
      p.age,
    );
    // Flag if physiology was already abnormal at the time, or has since become so.
    if (newsAtOverride < CONTRADICTION_NEWS && p.news < CONTRADICTION_NEWS) continue;

    contradictions.push({
      overrideId: o.id,
      patientId: p.id,
      patientName: p.name,
      fromAcuity: o.fromAcuity,
      toAcuity: o.toAcuity,
      newsAtOverride,
      newsNow: p.news,
      reason: o.reason,
      nurse: o.nurse,
      atSimMinutes: o.atSimMinutes,
    });
  }

  contradictions.sort((a, b) => b.newsNow - a.newsNow);

  return {
    groups,
    findings,
    testsRun,
    contradictions,
    contradictionNewsThreshold: CONTRADICTION_NEWS,
    cohortSize: patients.length,
    generatedAtSimMinutes: Math.round(atSimMinutes),
  };
}
