/**
 * Age-stratified early warning scoring.
 *
 * WHY THIS MODULE EXISTS.
 *   NEWS2 — the score this prototype used for everybody until now — is
 *   calibrated for adults aged 16 and over and is explicitly not validated in
 *   children or pregnancy. Applying it across all ages is not a small
 *   inaccuracy: a heart rate of 150 is an emergency in a 40-year-old and
 *   unremarkable in a 6-month-old, and a respiratory rate of 26 is mildly raised
 *   in an adult and near-normal in a toddler.
 *
 *   The two age groups fail in OPPOSITE directions, which is why one table
 *   cannot serve both. For children the adult chart mostly OVER-reads — it
 *   treats age-appropriate tachycardia and tachypnoea as an emergency, which
 *   produces alarm fatigue and wasted resus activations. For older adults it
 *   UNDER-reads, and that is the one that kills: a blunted febrile response and
 *   a hypertensive baseline mean genuine sepsis can score zero.
 *
 *   Blood pressure is the exception and the trap. Paediatric hypotension is a
 *   late, near-terminal sign — children vasoconstrict and hold their pressure
 *   until they are close to arrest — so any hypotension in a child must score
 *   maximum. An early draft of the chart below scored a shocked three-year-old
 *   at one point; the unit tests caught it.
 *
 *   Older adults need the opposite correction. They mount a blunted febrile
 *   response, so 37.6 C in an 80-year-old carries the weight 38.5 C does in a
 *   30-year-old; and because so many are chronically hypertensive, a "normal"
 *   systolic of 115 can represent profound relative hypotension.
 *
 * SCOPE AND HONESTY.
 *   The thresholds below are drawn from standard published paediatric vital
 *   sign ranges and from NEWS2 for adults, but the point allocations are this
 *   prototype's own and are NOT a validated instrument. PEWS in real use is
 *   also chart-specific and varies between institutions. This is a demonstration
 *   that age stratification is structurally necessary, not a claim to have
 *   implemented any particular validated score.
 */

import type { AgeBand, Vitals } from "./types";

/**
 * Bands for one vital sign.
 *
 * Read as ascending cut-points: at or below `l3` scores 3, then `l2` scores 2,
 * then `l1` scores 1, up to `h0` scores 0 (normal), then `h1` scores 1, `h2`
 * scores 2, and anything above scores `hMax` (3 unless stated).
 *
 * A band is skipped by setting it equal to the one below it — NEWS2 has no
 * "2 points low" for heart rate, and no "1 point high" for respiratory rate.
 */
interface VitalBands {
  l3?: number;
  l2?: number;
  l1?: number;
  h0: number;
  h1?: number;
  h2?: number;
  hMax?: number;
}

function bandPoints(v: number, b: VitalBands): number {
  if (b.l3 !== undefined && v <= b.l3) return 3;
  if (b.l2 !== undefined && v <= b.l2) return 2;
  if (b.l1 !== undefined && v <= b.l1) return 1;
  if (v <= b.h0) return 0;
  if (b.h1 !== undefined && v <= b.h1) return 1;
  if (b.h2 !== undefined && v <= b.h2) return 2;
  return b.hMax ?? 3;
}

type Chart = Record<"hr" | "rr" | "sbp" | "spo2" | "temp", VitalBands>;

/**
 * Age bands. The paediatric splits follow the ranges physiology actually
 * changes at, not round numbers: heart rate and respiratory rate fall steeply
 * through infancy and settle to adult values around adolescence.
 */
export function ageBandFor(age: number): AgeBand {
  if (age < 1) return "infant";
  if (age < 5) return "toddler";
  if (age < 12) return "child";
  if (age < 16) return "adolescent";
  if (age < 65) return "adult";
  return "older adult";
}

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  infant: "Infant (<1y)",
  toddler: "Toddler (1–4y)",
  child: "Child (5–11y)",
  adolescent: "Adolescent (12–15y)",
  adult: "Adult (16–64y)",
  "older adult": "Older adult (65+)",
};

/** Which scoring instrument each band is derived from, for display. */
export const AGE_BAND_CHART: Record<AgeBand, string> = {
  infant: "Paediatric (infant)",
  toddler: "Paediatric (1–4y)",
  child: "Paediatric (5–11y)",
  adolescent: "Paediatric (12–15y)",
  adult: "NEWS2",
  "older adult": "NEWS2 + geriatric adjustment",
};

const CHARTS: Record<AgeBand, Chart> = {
  // Normal HR 110-160, RR 30-60, SBP >70. Infants compensate by tachycardia
  // and tachypnoea and lose blood pressure very late, so the low-SBP bands are
  // deliberately narrow and severe.
  infant: {
    hr: { l3: 80, l2: 90, l1: 100, h0: 160, h1: 180, h2: 190 },
    rr: { l3: 20, l1: 25, h0: 60, h1: 70, h2: 80 },
    // Hypotension in an infant is < 70 systolic and is pre-terminal.
    sbp: { l3: 70, l2: 76, l1: 82, h0: 110 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35.5, l1: 36, h0: 37.9, h1: 38.5, hMax: 2 },
  },
  // Normal HR 90-140, RR 20-30, SBP >75.
  toddler: {
    hr: { l3: 70, l1: 80, h0: 140, h1: 160, h2: 180 },
    rr: { l3: 15, l1: 18, h0: 30, h1: 40, h2: 50 },
    // Hypotension is roughly < 70 + 2 x age, so ~76 at three years old.
    sbp: { l3: 74, l2: 80, l1: 86, h0: 115 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35.5, l1: 36, h0: 37.9, h1: 38.5, hMax: 2 },
  },
  // Normal HR 70-120, RR 18-25, SBP >80.
  child: {
    hr: { l3: 55, l1: 65, h0: 120, h1: 140, h2: 160 },
    rr: { l3: 12, l1: 15, h0: 25, h1: 32, h2: 40 },
    // ~86 at eight years old.
    sbp: { l3: 84, l2: 90, l1: 96, h0: 120 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35.5, l1: 36, h0: 37.9, h1: 38.5, hMax: 2 },
  },
  // Approaching adult values.
  adolescent: {
    hr: { l3: 45, l1: 55, h0: 100, h1: 120, h2: 140 },
    rr: { l3: 9, l1: 11, h0: 20, h1: 26, h2: 32 },
    sbp: { l3: 88, l2: 94, l1: 100, h0: 130 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35.5, l1: 36, h0: 38, h1: 39, hMax: 2 },
  },
  // NEWS2, unchanged.
  adult: {
    hr: { l3: 40, l1: 50, h0: 90, h1: 110, h2: 130 },
    rr: { l3: 8, l1: 11, h0: 20, h1: 20, h2: 24 },
    sbp: { l3: 90, l2: 100, l1: 110, h0: 219 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35, l1: 36, h0: 38, h1: 39, hMax: 2 },
  },
  // NEWS2 with two geriatric corrections:
  //   - systolic cut-points raised ~10 mmHg, because a chronically hypertensive
  //     patient at 115 may be profoundly hypotensive relative to their baseline
  //   - fever thresholds lowered, because the febrile response is blunted with
  //     age and a low-grade temperature is a genuine sepsis signal
  "older adult": {
    hr: { l3: 40, l1: 50, h0: 90, h1: 110, h2: 130 },
    rr: { l3: 8, l1: 11, h0: 20, h1: 20, h2: 24 },
    sbp: { l3: 100, l2: 110, l1: 120, h0: 219 },
    spo2: { l3: 91, l2: 93, l1: 95, h0: 100 },
    temp: { l3: 35.5, l1: 36, h0: 37.5, h1: 38.5, hMax: 2 },
  },
};

/** Per-vital contribution, so the UI can show which vital is driving the score. */
export function ewsContributions(
  v: Vitals,
  age: number,
): Record<keyof Vitals, number> {
  const c = CHARTS[ageBandFor(age)];
  return {
    hr: bandPoints(v.hr, c.hr),
    sbp: bandPoints(v.sbp, c.sbp),
    dbp: 0, // diastolic is not scored on any of these charts
    rr: bandPoints(v.rr, c.rr),
    spo2: bandPoints(v.spo2, c.spo2),
    temp: bandPoints(v.temp, c.temp),
  };
}

/**
 * Age-appropriate early warning score.
 *
 * Replaces the adult-only `newsScore`. Same 0-20ish range across all bands, so
 * downstream weighting does not have to know which chart was used.
 */
export function earlyWarningScore(v: Vitals, age: number): number {
  const c = ewsContributions(v, age);
  return c.hr + c.sbp + c.rr + c.spo2 + c.temp;
}

export function ewsBand(score: number): "low" | "medium" | "high" {
  if (score >= 7) return "high";
  if (score >= 5) return "medium";
  return "low";
}

/**
 * What the SAME observations would have scored on the adult chart.
 *
 * Kept deliberately, and shown in the UI for non-adults, because it is the
 * clearest possible demonstration of why age stratification is not optional:
 * for a child it is usually a large over-estimate, and for an older adult a
 * dangerous under-estimate.
 */
export function adultChartScore(v: Vitals): number {
  const c = CHARTS.adult;
  return (
    bandPoints(v.hr, c.hr) +
    bandPoints(v.sbp, c.sbp) +
    bandPoints(v.rr, c.rr) +
    bandPoints(v.spo2, c.spo2) +
    bandPoints(v.temp, c.temp)
  );
}
