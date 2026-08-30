/**
 * The time-decay urgency model.
 *
 * The whole point of the prototype: an ESI acuity level assigned once at intake
 * is a *static* number, but a patient's priority is a *function of time*. This
 * module defines that function.
 *
 *   urgency(t) = base(acuity)
 *              + escalationRate(acuity, atypical) * waitMinutes   ... capped
 *              + atypicalBoost
 *              + riskFactorBoost            <- named clinical risks from the model
 *              + ambientBoost
 *              + physiologyWeight * NEWS(vitals(t))
 *
 * Every term is deliberately simple and inspectable — the UI renders this exact
 * decomposition in the patient drawer so a demo viewer can see *why* someone
 * moved up the queue.
 *
 * NOT CLINICALLY VALIDATED. Every constant below is invented. They are exposed
 * as an injectable `UrgencyWeights` object rather than hard-coded specifically
 * so that src/lib/analysis.ts can sweep them and report which ones the queue
 * ordering is actually sensitive to — see the "Model evidence" panel. A
 * parameter the ranking barely responds to is defensible as arbitrary; one it
 * responds to strongly is a stated risk, not a hidden one.
 *
 * BALANCE NOTE. An earlier revision used base = 20 x (6 - acuity), which made
 * the intake score ~70% of the total and left the whole system ~95% correlated
 * with a purely static ordering — i.e. it reproduced the very failure it exists
 * to fix. The base is deliberately compressed now so the dynamic terms can
 * actually overturn an intake decision. The ablation panel measures this.
 */

import { earlyWarningScore } from "./ews";
import type {
  AcuityLevel,
  AgeBand,
  DataCompleteness,
  EscalationStatus,
  RiskFactor,
  UrgencyBreakdown,
  VitalTrajectory,
  Vitals,
} from "./types";

/**
 * Named clinical risks the model can attach to a patient, with the urgency each
 * carries. These encode TIME-CRITICALITY, which is exactly what an ESI level
 * does not: an ESI-3 with an airway risk and an ESI-3 with a kidney stone are
 * the same number and very different problems.
 *
 * This is what makes the language model load-bearing rather than decorative —
 * remove it and specific, identifiable patients lose specific points.
 */
/**
 * Maximum lift a red flag may apply — the safety cap on the floor below.
 *
 * Sized at roughly two ESI levels. Small enough that the model cannot teleport
 * anyone to the top of the queue on one word, large enough that the floor can
 * actually bind: an earlier revision capped these at 12-16 against floors of
 * 74-92, which meant the floor was unreachable and the whole term was
 * decorative. The ablation panel is what exposed that.
 */
export const RISK_FACTOR_WEIGHT: Record<RiskFactor, number> = {
  airway_compromise: 34,
  neuro_red_flag: 30,
  cardiac_ischaemia: 28,
  thromboembolic: 26,
  sepsis: 26,
  haemorrhage: 26,
  none: 0,
};

/**
 * The urgency floor each named risk implies, regardless of assigned acuity.
 *
 * WHY A FLOOR AND NOT A BONUS. The first version of this term simply added
 * points, and the ablation panel immediately showed it moved ZERO rows despite
 * contributing 12% of all urgency: the model attaches risks to exactly the
 * patients it already scored as urgent, so a flat bonus inflated everyone
 * equally and decided nothing. Perfectly collinear with the base term, and
 * therefore decorative.
 *
 * A floor breaks that collinearity, and it is also how a red flag actually
 * behaves clinically: it does not make a resus patient more resus, it stops a
 * patient being left in the queue at ESI-4 with a story that could be an MI.
 * The term is worth the most where the acuity number is most likely wrong, and
 * nothing at all where the patient is already prioritised correctly.
 */
export const RISK_FACTOR_FLOOR: Record<RiskFactor, number> = {
  airway_compromise: 92,
  neuro_red_flag: 84,
  cardiac_ischaemia: 80,
  thromboembolic: 74,
  sepsis: 76,
  haemorrhage: 74,
  none: 0,
};

export interface UrgencyWeights {
  basePerLevel: Record<AcuityLevel, number>;
  escalationRatePerMin: Record<AcuityLevel, number>;
  atypicalRateMultiplier: number;
  atypicalBoost: number;
  ambientBoost: number;
  physiologyWeight: number;
  maxWaitPressure: number;
  riskFactorWeight: Record<RiskFactor, number>;
  riskFactorFloor: Record<RiskFactor, number>;
  urgencyMax: number;
}

/**
 * Base urgency from the assigned ESI level. Compressed to a 12-point step (was
 * 20) so that accumulated waiting and drifting physiology can realistically
 * overturn an intake decision instead of merely reordering within a level.
 */
export const BASE_PER_LEVEL: Record<AcuityLevel, number> = {
  1: 60,
  2: 48,
  3: 36,
  4: 24,
  5: 12,
};

/**
 * Urgency points accrued per minute of waiting, by acuity.
 * Sicker patients "decay" faster: an ESI-2 left in the waiting room becomes
 * dangerous much sooner than an ESI-5.
 */
export const ESCALATION_RATE_PER_MIN: Record<AcuityLevel, number> = {
  1: 0.34,
  2: 0.26,
  3: 0.18,
  4: 0.12,
  5: 0.06,
};

/**
 * An atypical presentation of a serious condition is exactly the case where the
 * intake number is least trustworthy, so time hurts more. Both a constant boost
 * and a faster clock.
 */
export const ATYPICAL_RATE_MULTIPLIER = 2.0;
export const ATYPICAL_BOOST = 10;

/** Simulated ambient-sensing flag (stretch module 4) nudges, never decides. */
export const AMBIENT_BOOST = 6;

/** Each NEWS point is worth this much urgency. */
export const PHYSIOLOGY_WEIGHT = 4;

/** Wait pressure alone can never exceed this, so it can't swamp physiology. */
export const MAX_WAIT_PRESSURE = 55;

/** Ceiling, set above the realistic maximum so nobody piles up on the clamp. */
export const URGENCY_MAX = 200;

/**
 * SAFETY-FIRST DESIGN — the precautionary uplift.
 *
 * Under-triage and over-triage do not cost the same. Sending a well patient to
 * be seen early wastes a slot; leaving a deteriorating one in the queue can kill
 * them. A system optimised for average accuracy will happily trade one for the
 * other, so this one is deliberately not: wherever the assistant is uncertain,
 * it adds urgency. The term is one-directional by construction — there is no
 * path through this code that lowers a score because information is missing.
 *
 * Four sources of uncertainty, each with its own visible line in the breakdown:
 */
export const UPLIFT = {
  /** The model told us it was unsure. Scaled by how unsure. */
  lowConfidence: 14,
  /** Confidence at or below this is treated as genuinely uncertain. */
  lowConfidenceThreshold: 0.6,
  /** First presentation, nothing on file — we are working blind on history. */
  zeroHistory: 8,
  /** Observations we could not obtain, per missing vital. */
  perMissingVital: 5,
  /**
   * Children compensate and then crash: a child can hold a normal blood
   * pressure until they are close to arrest. Infants and toddlers get a
   * standing margin because "looks stable" is least reliable in them.
   */
  paediatricMargin: 10,
  /** Older adults present atypically and deteriorate faster from a lower reserve. */
  geriatricMargin: 6,
} as const;

/**
 * How long each acuity level may safely wait before a mandatory re-assessment.
 * Broadly aligned with published ESI/ATS targets. Breaching these is what the
 * brief calls "monitor patients already in the waiting queue and trigger
 * re-assessment if wait time exceeds safe thresholds for their severity level".
 */
export const SAFE_WAIT_MINUTES: Record<AcuityLevel, number> = {
  1: 0,
  2: 10,
  3: 30,
  4: 60,
  5: 120,
};

export const DEFAULT_WEIGHTS: UrgencyWeights = {
  basePerLevel: BASE_PER_LEVEL,
  escalationRatePerMin: ESCALATION_RATE_PER_MIN,
  atypicalRateMultiplier: ATYPICAL_RATE_MULTIPLIER,
  atypicalBoost: ATYPICAL_BOOST,
  ambientBoost: AMBIENT_BOOST,
  physiologyWeight: PHYSIOLOGY_WEIGHT,
  maxWaitPressure: MAX_WAIT_PRESSURE,
  riskFactorWeight: RISK_FACTOR_WEIGHT,
  riskFactorFloor: RISK_FACTOR_FLOOR,
  urgencyMax: URGENCY_MAX,
};

/**
 * Escalation bands.
 *
 * ESCALATION_THRESHOLD is the headline number: "this patient should have been
 * re-triaged by now". CRITICAL is deliberately set so only a small minority of
 * the board can occupy it at once — a wallboard where half the rows are red
 * teaches staff to ignore red, which is worse than no alert at all.
 */
export const WATCH_THRESHOLD = 55;
export const ESCALATION_THRESHOLD = 90;
export const CRITICAL_THRESHOLD = 105;

// ---------------------------------------------------------------------------
// NEWS — National Early Warning Score (simplified, standard public thresholds).
// A deterministic, non-AI physiologic severity score. It gives the equity audit
// a severity variable to control for, and gives urgency a reason to move that
// isn't just "time passed".
// ---------------------------------------------------------------------------

function rrPoints(rr: number): number {
  if (rr <= 8) return 3;
  if (rr <= 11) return 1;
  if (rr <= 20) return 0;
  if (rr <= 24) return 2;
  return 3;
}

function spo2Points(spo2: number): number {
  if (spo2 <= 91) return 3;
  if (spo2 <= 93) return 2;
  if (spo2 <= 95) return 1;
  return 0;
}

function tempPoints(temp: number): number {
  if (temp <= 35.0) return 3;
  if (temp <= 36.0) return 1;
  if (temp <= 38.0) return 0;
  if (temp <= 39.0) return 1;
  return 2;
}

function sbpPoints(sbp: number): number {
  if (sbp <= 90) return 3;
  if (sbp <= 100) return 2;
  if (sbp <= 110) return 1;
  if (sbp <= 219) return 0;
  return 3;
}

function hrPoints(hr: number): number {
  if (hr <= 40) return 3;
  if (hr <= 50) return 1;
  if (hr <= 90) return 0;
  if (hr <= 110) return 1;
  if (hr <= 130) return 2;
  return 3;
}

export function newsScore(v: Vitals): number {
  return (
    rrPoints(v.rr) +
    spo2Points(v.spo2) +
    tempPoints(v.temp) +
    sbpPoints(v.sbp) +
    hrPoints(v.hr)
  );
}

export function newsBand(news: number): "low" | "medium" | "high" {
  if (news >= 7) return "high";
  if (news >= 5) return "medium";
  return "low";
}

/** Per-vital NEWS contribution, so the UI can highlight which vital is driving it. */
export function newsContributions(v: Vitals): Record<keyof Vitals, number> {
  return {
    hr: hrPoints(v.hr),
    sbp: sbpPoints(v.sbp),
    dbp: 0, // diastolic is not part of NEWS
    rr: rrPoints(v.rr),
    spo2: spo2Points(v.spo2),
    temp: tempPoints(v.temp),
  };
}

// ---------------------------------------------------------------------------
// Vital drift over simulated time
// ---------------------------------------------------------------------------

const VITAL_BOUNDS: Record<keyof Vitals, [number, number]> = {
  hr: [30, 190],
  sbp: [60, 230],
  dbp: [35, 140],
  rr: [6, 46],
  spo2: [70, 100],
  temp: [33, 42],
};

/** Deterministic hash -> [-1, 1]. Same input always gives the same jitter. */
function jitter(seed: string, t: number): number {
  let h = 2166136261;
  const key = `${seed}:${Math.floor(t)}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** How stale observations have to be before the UI stops trusting them. */
export const VITALS_STALE_AFTER_MINUTES = 30;

export interface ProjectedVitals {
  vitals: Vitals;
  /** Simulated minutes since these numbers were actually measured. */
  ageMinutes: number;
}

/**
 * Project a patient's observations forward to `waitMinutes` of waiting.
 *
 * Deliberately NOT a clean linear ramp any more. Three things happen here that
 * did not before, each of which makes the detection problem honest rather than
 * self-fulfilling:
 *
 *   - NOISE. Per-vital deterministic jitter, so NEWS wobbles the way real
 *     observations wobble and a threshold crossing is not guaranteed by
 *     monotonicity alone.
 *   - INFLECTION. Drift can change direction — analgesia works, or compensation
 *     fails — so "goes up forever" is no longer the only story the data tells.
 *   - STALENESS. Past `staleAfterMinutes` nobody re-measures. The observations
 *     freeze and `ageMinutes` starts climbing. This is the case that matters
 *     most: continuous re-scoring is blind exactly when the data stops arriving,
 *     and pretending otherwise was the biggest lie in the earlier model.
 *
 * Still deterministic — the same simulated minute always yields the same
 * numbers, so a demo stays reproducible.
 */
export function projectVitals(
  arrival: Vitals,
  trajectory: VitalTrajectory,
  waitMinutes: number,
  seed = "",
): ProjectedVitals {
  const requested = Math.max(0, waitMinutes);
  const stale = trajectory.staleAfterMinutes;
  // Past the staleness point the numbers simply stop updating.
  const t = stale !== undefined ? Math.min(requested, stale) : requested;
  const ageMinutes = requested - t;

  const inflection = trajectory.inflectionMinutes;
  const out = { ...arrival };

  for (const key of Object.keys(out) as (keyof Vitals)[]) {
    const primary = trajectory[key] ?? 0;
    const after = trajectory.after?.[key] ?? 0;

    let delta: number;
    if (inflection !== undefined && t > inflection) {
      delta = primary * inflection + after * (t - inflection);
    } else {
      delta = primary * t;
    }

    const amp = trajectory.noise?.[key] ?? 0;
    if (amp !== 0) delta += amp * jitter(`${seed}:${key}`, t);

    if (delta === 0) continue;
    const [lo, hi] = VITAL_BOUNDS[key];
    out[key] = Math.min(hi, Math.max(lo, out[key] + delta));
  }

  out.hr = Math.round(out.hr);
  out.sbp = Math.round(out.sbp);
  out.dbp = Math.round(out.dbp);
  out.rr = Math.round(out.rr);
  out.spo2 = Math.round(out.spo2 * 10) / 10;
  out.temp = Math.round(out.temp * 10) / 10;

  return { vitals: out, ageMinutes };
}

// ---------------------------------------------------------------------------
// The urgency function
// ---------------------------------------------------------------------------

export interface UrgencyInput {
  acuity: AcuityLevel;
  waitMinutes: number;
  atypical: boolean;
  ambient: boolean;
  vitals: Vitals;
  /** Age drives which early-warning chart applies. Required — never assume adult. */
  age: number;
  ageBand: AgeBand;
  /** Named clinical risks the model attached to this patient. */
  riskFactors?: RiskFactor[];
  /** 0..1 model confidence. Low confidence raises urgency, never lowers it. */
  confidence?: number;
  completeness?: DataCompleteness;
}

/** The safety margin, itemised so the UI can show exactly why it was applied. */
export function precautionaryUplift(input: UrgencyInput): {
  total: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let total = 0;

  const confidence = input.confidence ?? 1;
  if (confidence <= UPLIFT.lowConfidenceThreshold) {
    // Scaled: 0.6 confidence adds a little, 0.2 adds a lot.
    const shortfall =
      (UPLIFT.lowConfidenceThreshold - confidence) / UPLIFT.lowConfidenceThreshold;
    const pts = Math.round(UPLIFT.lowConfidence * shortfall);
    if (pts > 0) {
      total += pts;
      reasons.push(`model confidence ${(confidence * 100).toFixed(0)}% (+${pts})`);
    }
  }

  if (input.completeness?.zeroHistory) {
    total += UPLIFT.zeroHistory;
    reasons.push(`first presentation, no record on file (+${UPLIFT.zeroHistory})`);
  }

  const missingVitals = input.completeness?.hasFullVitals === false
    ? (input.completeness.missing.filter((m) => m.startsWith("vital:")).length || 1)
    : 0;
  if (missingVitals > 0) {
    const pts = missingVitals * UPLIFT.perMissingVital;
    total += pts;
    reasons.push(`${missingVitals} observation(s) unobtainable (+${pts})`);
  }

  if (
    input.ageBand === "infant" ||
    input.ageBand === "toddler" ||
    input.ageBand === "child"
  ) {
    total += UPLIFT.paediatricMargin;
    reasons.push(
      `paediatric — compensates then decompensates late (+${UPLIFT.paediatricMargin})`,
    );
  } else if (input.ageBand === "older adult") {
    total += UPLIFT.geriatricMargin;
    reasons.push(
      `older adult — atypical presentation, low reserve (+${UPLIFT.geriatricMargin})`,
    );
  }

  return { total, reasons };
}

export function computeUrgency(
  input: UrgencyInput,
  w: UrgencyWeights = DEFAULT_WEIGHTS,
): UrgencyBreakdown {
  const { acuity, waitMinutes, atypical, ambient, vitals } = input;
  const riskFactors = input.riskFactors ?? [];

  const base = w.basePerLevel[acuity];

  const escalationRatePerMin =
    w.escalationRatePerMin[acuity] * (atypical ? w.atypicalRateMultiplier : 1);

  const waitPressure = Math.min(
    w.maxWaitPressure,
    escalationRatePerMin * Math.max(0, waitMinutes),
  );

  const atypicalBoost = atypical ? w.atypicalBoost : 0;
  const ambientBoost = ambient ? w.ambientBoost : 0;
  const physiologyPressure =
    w.physiologyWeight * earlyWarningScore(vitals, input.age);

  const uplift = precautionaryUplift(input);

  // Everything the score knows about this patient before red flags are applied.
  const withoutRisk =
    base +
    waitPressure +
    atypicalBoost +
    ambientBoost +
    physiologyPressure +
    uplift.total;

  // Only the single strongest risk counts. Summing them would let a verbose
  // model inflate a patient by listing everything it can think of.
  const floor = riskFactors.reduce(
    (max, f) => Math.max(max, w.riskFactorFloor[f] ?? 0),
    0,
  );
  const cap = riskFactors.reduce(
    (max, f) => Math.max(max, w.riskFactorWeight[f] ?? 0),
    0,
  );
  // Lift toward the floor, but never by more than the risk's own weight — so a
  // red flag can rescue an under-triaged patient without letting the model
  // teleport anyone to the top of the queue on one word.
  const riskFactorBoost = Math.min(cap, Math.max(0, floor - withoutRisk));

  const raw = withoutRisk + riskFactorBoost;
  const total = Math.min(w.urgencyMax, Math.round(raw * 10) / 10);

  return {
    base,
    precautionaryUplift: uplift.total,
    waitPressure: Math.round(waitPressure * 10) / 10,
    atypicalBoost,
    riskFactorBoost,
    ambientBoost,
    physiologyPressure,
    total,
    escalationRatePerMin: Math.round(escalationRatePerMin * 1000) / 1000,
  };
}

export function escalationStatus(urgency: number): EscalationStatus {
  if (urgency >= CRITICAL_THRESHOLD) return "critical";
  if (urgency >= ESCALATION_THRESHOLD) return "escalated";
  if (urgency >= WATCH_THRESHOLD) return "watch";
  return "stable";
}

/**
 * First simulated minute (relative to arrival) at which this patient's urgency
 * crosses ESCALATION_THRESHOLD, or null if it never does within `horizon`.
 * Coarse 1-minute scan — cheap, and exact enough for a demo.
 */
const crossingCache = new Map<string, number | null>();

/**
 * First simulated minute (relative to arrival) at which this patient's urgency
 * crosses ESCALATION_THRESHOLD, or null if it never does within `horizon`.
 *
 * Memoised. The answer depends only on the arrival vitals, the dynamics, the
 * acuity and the flags — none of which change between polls — but this used to
 * re-run a 480-step scan for every patient on every request, which at 1 Hz with
 * a handful of wallboards was a quarter of a million pointless computations a
 * second, all returning the same number.
 */
export interface CrossingInput {
  arrivalVitals: Vitals;
  trajectory: VitalTrajectory;
  acuity: AcuityLevel;
  atypical: boolean;
  ambient: boolean;
  age: number;
  ageBand: AgeBand;
  riskFactors?: RiskFactor[];
  confidence?: number;
  completeness?: DataCompleteness;
  horizonMinutes?: number;
}

export function findEscalationCrossing(input: CrossingInput): number | null {
  const {
    arrivalVitals,
    trajectory,
    acuity,
    atypical,
    ambient,
    age,
    ageBand,
    riskFactors = [],
    confidence,
    completeness,
    horizonMinutes = 480,
  } = input;

  const key = JSON.stringify([
    arrivalVitals,
    trajectory,
    acuity,
    atypical,
    ambient,
    [...riskFactors].sort(),
    age,
    confidence,
    completeness?.zeroHistory,
    completeness?.hasFullVitals,
    horizonMinutes,
  ]);
  const hit = crossingCache.get(key);
  if (hit !== undefined) return hit;

  let result: number | null = null;
  for (let t = 0; t <= horizonMinutes; t += 1) {
    const u = computeUrgency({
      acuity,
      waitMinutes: t,
      atypical,
      ambient,
      riskFactors,
      age,
      ageBand,
      confidence,
      completeness,
      vitals: projectVitals(arrivalVitals, trajectory, t).vitals,
    }).total;
    if (u >= ESCALATION_THRESHOLD) {
      result = t;
      break;
    }
  }
  crossingCache.set(key, result);
  return result;
}

/** Urgency trace over time, for the sparkline in the patient drawer. */
export function urgencyTrace(
  arrivalVitals: Vitals,
  trajectory: VitalTrajectory,
  acuity: AcuityLevel,
  atypical: boolean,
  ambient: boolean,
  fromMinutes: number,
  toMinutes: number,
  steps = 40,
  riskFactors: RiskFactor[] = [],
  age = 40,
  ageBand: AgeBand = "adult",
): { t: number; urgency: number; news: number }[] {
  const out: { t: number; urgency: number; news: number }[] = [];
  const span = Math.max(1, toMinutes - fromMinutes);
  for (let i = 0; i <= steps; i += 1) {
    const t = fromMinutes + (span * i) / steps;
    const { vitals } = projectVitals(arrivalVitals, trajectory, t);
    out.push({
      t: Math.round(t),
      urgency: computeUrgency({
        acuity,
        waitMinutes: t,
        atypical,
        ambient,
        riskFactors,
        age,
        ageBand,
        vitals,
      }).total,
      news: earlyWarningScore(vitals, age),
    });
  }
  return out;
}
