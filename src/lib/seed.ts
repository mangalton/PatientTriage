/**
 * SYNTHETIC SEED DATA — 100% fabricated.
 *
 * Every name is randomly assembled, every vital sign is invented, and none of
 * these cases corresponds to a real person or a real encounter. This file
 * contains no PHI and no PII, and nothing here may be used clinically.
 *
 * The roster is hand-built (not random) because it has to tell two stories on
 * load:
 *
 *   STORY 1 — silent deterioration.
 *     P-017 (Mehra) arrives 12 simulated minutes ago looking completely
 *     benign: "indigestion", every vital in range, NEWS 0. A nurse has already
 *     downgraded him one ESI level ("ambulatory and comfortable"). His hidden
 *     trajectory is an evolving inferior MI, so his vitals drift for the whole
 *     demo. Fast-forward ~60-90 simulated minutes and he climbs from the bottom
 *     third of the queue to the top — which is precisely the event a static
 *     intake score cannot produce.
 *
 *   STORY 2 — an equity gap in the human override layer.
 *     Every one of the five pre-seeded nurse downgrades landed on a patient who
 *     WALKED IN, and each carries a soft, non-physiologic justification
 *     ("frequent presenter", "pain score inconsistent with observed behaviour").
 *     Not one patient who arrived by ambulance or on referral was downgraded.
 *     Three of those downgrades were applied to people whose own NEWS was
 *     climbing at the time. The audit finds both patterns without recording a
 *     single fact about who any of these patients are.
 *
 * Seeded overrides are stored as a DELTA (+1 = deprioritised by one ESI level)
 * rather than an absolute level, so the story holds whatever acuity the local
 * model happens to assign.
 */

import type {
  AcuityLevel,
  AmbientFlag,
  Bed,
  ArrivalMode,
  Patient,
  Sex,
  VitalTrajectory,
  Vitals,
} from "./types";

/** Simulated minutes since ED "day start" (08:00) when the demo opens. */
export const INITIAL_SIM_MINUTES = 100;

/** Wall-clock label for simulated minute 0. */
export const DAY_START_HOUR = 8;

export interface SeededOverride {
  /** +1 deprioritises by one ESI level, -1 escalates by one. */
  delta: 1 | -1 | 2 | -2;
  reason: string;
  nurse: string;
  /** Minutes after this patient's arrival at which the override was recorded. */
  afterArrivalMinutes: number;
}

export interface SeedPatient {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  arrivalMode: ArrivalMode;
  chiefComplaint: string;
  narrative: string;
  arrivalVitals: Vitals;
  trajectory: VitalTrajectory;
  arrivalSimMinutes: number;
  ambient: AmbientFlag | null;
  seededOverride: SeededOverride | null;
  teachingNote: string | null;
}

const v = (
  hr: number,
  sbp: number,
  dbp: number,
  rr: number,
  spo2: number,
  temp: number,
): Vitals => ({ hr, sbp, dbp, rr, spo2, temp });

export const SEED_PATIENTS: SeedPatient[] = [
  {
    id: "P-001",
    name: "Das, R.",
    age: 34,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Chest tightness and shortness of breath since this morning",
    narrative:
      "Sudden-onset pleuritic chest tightness on waking. Two weeks post long-haul flight. Taking combined oral contraceptive. No cough, no fever.",
    arrivalVitals: v(108, 118, 74, 22, 94, 37.1),
    trajectory: {
      hr: 0.05,
      spo2: -0.008,
      noise: { hr: 3.5, rr: 1.2, spo2: 0.7, sbp: 4 },
    },
    arrivalSimMinutes: 4,
    ambient: null,
    seededOverride: {
      delta: 1,
      reason: "Anxiety-related; pt speaking in full sentences and settled.",
      nurse: "RN Pillai",
      afterArrivalMinutes: 6,
    },
    teachingNote:
      "Risk factors (recent long-haul flight + oestrogen-containing contraception) plus hypoxia and tachypnoea point to PE, not anxiety.",
  },
  {
    id: "P-002",
    name: "Deshmukh, V.",
    age: 71,
    sex: "M",
    arrivalMode: "Ambulance",
    chiefComplaint: "Fell at home, hip pain, unable to bear weight",
    narrative:
      "Mechanical fall from standing height onto left side. No head strike, no LOC. On apixaban for atrial fibrillation.",
    arrivalVitals: v(96, 128, 76, 18, 96, 36.6),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 12,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-003",
    name: "Sharma, A.",
    age: 22,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Ankle sprain playing soccer",
    narrative:
      "Inversion injury 90 minutes ago. Weight-bearing with a limp. Neurovascularly intact.",
    arrivalVitals: v(78, 118, 72, 14, 99, 36.7),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 20,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-004",
    name: "Bhattacharya, S.",
    age: 55,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Abdominal pain and vomiting for two days",
    narrative:
      "Diffuse abdominal pain, six episodes of vomiting, reduced oral intake. Type 2 diabetes. Third ED visit in four months.",
    arrivalVitals: v(112, 104, 62, 21, 96, 38.4),
    trajectory: {
      hr: 0.07,
      sbp: -0.09,
      temp: 0.004,
      // Compensating, then losing it — sepsis is not a straight line.
      inflectionMinutes: 70,
      after: { hr: 0.16, sbp: -0.24, rr: 0.05 },
      noise: { hr: 4, rr: 1.2, sbp: 5, temp: 0.15 },
    },
    arrivalSimMinutes: 25,
    ambient: null,
    seededOverride: {
      delta: 1,
      reason: "Frequent presenter; likely gastritis, for oral fluids in waiting room.",
      nurse: "RN Pillai",
      afterArrivalMinutes: 9,
    },
    teachingNote:
      "Tachycardia, fever, and a narrowing pulse pressure in a diabetic patient — this is a sepsis trajectory, not gastritis.",
  },
  {
    id: "P-005",
    name: "Fernandes, S.",
    age: 63,
    sex: "M",
    arrivalMode: "Ambulance",
    chiefComplaint: "Productive cough and fever for three days",
    narrative:
      "Green sputum, right-sided pleuritic pain, increasing breathlessness. Ex-smoker, 30 pack-years.",
    arrivalVitals: v(104, 112, 68, 24, 92, 38.9),
    trajectory: {
      spo2: -0.02,
      rr: 0.02,
      noise: { hr: 4, rr: 1.5, spo2: 0.9 },
    },
    arrivalSimMinutes: 30,
    ambient: {
      reason: "Audible laboured breathing and frequent coughing detected in waiting area",
      confidence: 0.71,
    },
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-006",
    name: "Verma, P.",
    age: 47,
    sex: "M",
    arrivalMode: "Walk-in",
    chiefComplaint: "Laceration to forearm, bleeding controlled",
    narrative:
      "Clean 4 cm laceration from a kitchen knife 40 minutes ago. Direct pressure effective. Tetanus up to date.",
    arrivalVitals: v(88, 134, 84, 16, 98, 36.9),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 36,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-007",
    name: "Kulkarni, L.",
    age: 29,
    sex: "F",
    arrivalMode: "Referred",
    chiefComplaint: "Severe headache with photophobia",
    narrative:
      "History of migraine, but states this one is different. On re-interview describes maximal intensity within seconds of onset while exercising.",
    arrivalVitals: v(84, 126, 78, 16, 98, 36.8),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 42,
    ambient: null,
    seededOverride: {
      delta: -1,
      reason: "Thunderclap onset elicited on re-interview — needs urgent imaging.",
      nurse: "RN Nair",
      afterArrivalMinutes: 11,
    },
    teachingNote:
      "An upgrade override: the nurse extracted history the intake note missed. Overrides are not always the failure mode.",
  },
  {
    id: "P-008",
    name: "Mondal, K.",
    age: 41,
    sex: "M",
    arrivalMode: "Walk-in",
    chiefComplaint: "Lower back pain, ongoing",
    narrative:
      "Three days of lumbar pain radiating to the left leg after lifting. No incontinence, no saddle anaesthesia, no fever.",
    arrivalVitals: v(98, 148, 92, 18, 97, 36.6),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 48,
    ambient: null,
    seededOverride: {
      delta: 1,
      reason: "Requesting analgesia by name; no documented red-flag features.",
      nurse: "RN Pillai",
      afterArrivalMinutes: 7,
    },
    teachingNote:
      "A justification built on drug-seeking suspicion rather than physiology. This is the pattern the equity audit is designed to surface.",
  },
  {
    id: "P-009",
    name: "Iyer, R.",
    age: 68,
    sex: "F",
    arrivalMode: "Ambulance",
    chiefComplaint: "Dizziness and palpitations",
    narrative:
      "Two hours of a racing, irregular heartbeat with light-headedness on standing. No chest pain. Not previously in atrial fibrillation.",
    arrivalVitals: v(132, 106, 64, 20, 96, 36.5),
    trajectory: {
      hr: 0.15,
      sbp: -0.07,
      // Rate slows and pressure recovers after she is given fluids in the
      // waiting room. Not every trajectory is a deterioration.
      inflectionMinutes: 45,
      after: { hr: -0.28, sbp: 0.14 },
      noise: { hr: 5, sbp: 4, rr: 1 },
    },
    arrivalSimMinutes: 53,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-010",
    name: "Agarwal, J.",
    age: 79,
    sex: "M",
    arrivalMode: "Ambulance",
    chiefComplaint: "Confusion, less responsive than usual",
    narrative:
      "Brought in by daughter. Two days of reduced oral intake and worsening confusion. Baseline is independent and fully oriented.",
    arrivalVitals: v(92, 98, 58, 22, 93, 37.9),
    trajectory: {
      sbp: -0.12,
      spo2: -0.012,
      hr: 0.08,
      noise: { hr: 3, rr: 1, sbp: 4 },
      // Nobody re-measures him. The system goes blind on the sickest patient
      // in the department, which is exactly when continuous scoring fails.
      staleAfterMinutes: 8,
    },
    arrivalSimMinutes: 58,
    ambient: {
      reason: "No verbal response to check-in kiosk prompt; slumped posture sustained >4 min",
      confidence: 0.83,
    },
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-011",
    name: "Subramanian, H.",
    age: 31,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Sore throat and earache",
    narrative:
      "Four days of sore throat, now with right ear pain. Eating and drinking normally. No trismus, no drooling.",
    arrivalVitals: v(82, 116, 72, 16, 99, 37.6),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 62,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-012",
    name: "Ghosh, M.",
    age: 26,
    sex: "M",
    arrivalMode: "Walk-in",
    chiefComplaint: "Sickle cell pain crisis, 9/10 pain",
    narrative:
      "Known HbSS disease. Typical crisis distribution in back and long bones, matching his documented personal care plan. Last transfusion four months ago.",
    arrivalVitals: v(106, 122, 70, 21, 94, 37.2),
    trajectory: {
      hr: 0.06,
      spo2: -0.01,
      noise: { hr: 4.5, rr: 1.4, spo2: 0.8 },
    },
    arrivalSimMinutes: 68,
    ambient: null,
    seededOverride: {
      delta: 1,
      reason: "Pain score inconsistent with observed behaviour; on phone in waiting area.",
      nurse: "RN Joshi",
      afterArrivalMinutes: 5,
    },
    teachingNote:
      "Under-treatment of sickle cell crisis is one of the best-documented disparities in emergency care. The patient has a care plan; the override ignores it.",
  },
  {
    id: "P-013",
    name: "Chopra, B.",
    age: 52,
    sex: "F",
    arrivalMode: "Ambulance",
    chiefComplaint: "Allergic reaction with rash and lip swelling",
    narrative:
      "Ate a shellfish dish 50 minutes ago. Urticarial rash over torso, lip swelling now progressing to tongue. No stridor yet.",
    arrivalVitals: v(110, 108, 66, 22, 95, 36.9),
    trajectory: {
      rr: 0.05,
      spo2: -0.015,
      noise: { hr: 4, rr: 1.6, spo2: 0.8 },
    },
    arrivalSimMinutes: 73,
    ambient: null,
    seededOverride: {
      delta: -1,
      reason: "Lip and tongue swelling progressing — airway watch, move up.",
      nurse: "RN Nair",
      afterArrivalMinutes: 4,
    },
    teachingNote: null,
  },
  {
    id: "P-014",
    name: "Malhotra, C.",
    age: 38,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Wrist injury after cycling fall",
    narrative:
      "FOOSH injury 2 hours ago. Deformity at the distal radius. Fingers warm, sensation intact, radial pulse present.",
    arrivalVitals: v(86, 124, 78, 16, 98, 36.7),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 78,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-015",
    name: "Banerjee, A.",
    age: 60,
    sex: "F",
    arrivalMode: "Referred",
    chiefComplaint: "Shortness of breath on exertion with ankle swelling",
    narrative:
      "Three weeks of worsening exertional dyspnoea, now breathless walking to the bathroom. Bilateral pitting oedema to mid-shin. Sleeps on three pillows.",
    arrivalVitals: v(100, 138, 86, 22, 93, 36.8),
    trajectory: {
      spo2: -0.015,
      rr: 0.03,
      noise: { hr: 3.5, rr: 1.3, spo2: 0.8 },
    },
    arrivalSimMinutes: 82,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-016",
    name: "Patil, D.",
    age: 45,
    sex: "M",
    arrivalMode: "Referred",
    chiefComplaint: "Flank pain, previous kidney stones",
    narrative:
      "Sudden left flank pain radiating to the groin, colicky, with one episode of vomiting. Two prior confirmed ureteric stones.",
    arrivalVitals: v(94, 142, 88, 18, 98, 36.9),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 86,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
  {
    id: "P-017",
    name: "Mehra, M.",
    age: 58,
    sex: "M",
    arrivalMode: "Walk-in",
    chiefComplaint: "Indigestion and mild jaw ache after yard work",
    narrative:
      "Started while mowing the lawn about an hour ago. Describes it as heartburn with an ache in the jaw and left elbow. Took an antacid with no relief. Type 2 diabetes, father had a heart attack at 61. Looks pale and is wiping his forehead repeatedly.",
    arrivalVitals: v(84, 132, 82, 17, 97, 36.8),
    trajectory: {
      hr: 0.3,
      sbp: -0.32,
      dbp: -0.18,
      rr: 0.045,
      spo2: -0.022,
      // Noise on the case the whole demo rests on. If the escalation only fires
      // on a clean ramp it is not a detector, it is a stopwatch.
      noise: { hr: 4, rr: 1.4, sbp: 5, spo2: 0.7 },
    },
    arrivalSimMinutes: 88,
    ambient: {
      reason: "Repeated hand-to-chest gesture and facial diaphoresis detected at check-in kiosk",
      confidence: 0.44,
    },
    seededOverride: {
      delta: 1,
      reason: "Ambulatory and comfortable; symptoms consistent with reflux.",
      nurse: "RN Joshi",
      afterArrivalMinutes: 3,
    },
    teachingNote:
      "DEMO STORY 1. Diabetic, family history, jaw and elbow radiation, diaphoresis — an atypical anterior MI presenting as indigestion. Every arrival vital is normal, so a static intake score can never catch this. Fast-forward the clock and watch the vitals drift and the urgency climb.",
  },
  {
    id: "P-018",
    name: "D'Souza, N.",
    age: 27,
    sex: "F",
    arrivalMode: "Walk-in",
    chiefComplaint: "Migraine, now resolving",
    narrative:
      "Typical migraine with visual aura, matches previous episodes. Took sumatriptan 90 minutes ago and reports the pain is settling.",
    arrivalVitals: v(76, 114, 70, 14, 99, 36.6),
    trajectory: { noise: { hr: 3, rr: 1, sbp: 4, spo2: 0.5 } },
    arrivalSimMinutes: 92,
    ambient: null,
    seededOverride: null,
    teachingNote: null,
  },
];

/** The patient the "silent deterioration" demo button jumps to. */
export const STORY_DETERIORATION_PATIENT_ID = "P-017";
/** The arrival route the equity story concerns. */
export const STORY_EQUITY_GROUP: ArrivalMode = "Walk-in";

export function buildPatients(): Patient[] {
  return SEED_PATIENTS.map((s) => ({
    id: s.id,
    name: s.name,
    age: s.age,
    sex: s.sex,
    arrivalMode: s.arrivalMode,
    chiefComplaint: s.chiefComplaint,
    narrative: s.narrative,
    arrivalVitals: { ...s.arrivalVitals },
    trajectory: { ...s.trajectory },
    arrivalSimMinutes: s.arrivalSimMinutes,
    ai: null,
    scoring: false,
    scoringError: null,
    overrideAcuity: null,
    ambient: s.ambient ? { ...s.ambient } : null,
    assignedBed: null,
    teachingNote: s.teachingNote,
  }));
}

export function clampAcuity(n: number): AcuityLevel {
  return Math.min(5, Math.max(1, Math.round(n))) as AcuityLevel;
}

// ---------------------------------------------------------------------------
// Beds for the flow-routing simulator (stretch module 6)
// ---------------------------------------------------------------------------

export function buildBeds(): Bed[] {
  return [
    { id: "RESUS-1", kind: "resus", minAcuity: 1, occupiedBy: null },
    { id: "RESUS-2", kind: "resus", minAcuity: 1, occupiedBy: "held: trauma call" },
    { id: "ACUTE-1", kind: "acute", minAcuity: 2, occupiedBy: null },
    { id: "ACUTE-2", kind: "acute", minAcuity: 2, occupiedBy: null },
    { id: "ACUTE-3", kind: "acute", minAcuity: 2, occupiedBy: "held: awaiting ward bed" },
    { id: "ACUTE-4", kind: "acute", minAcuity: 2, occupiedBy: null },
    { id: "ACUTE-5", kind: "acute", minAcuity: 2, occupiedBy: null },
    { id: "FT-1", kind: "fast-track", minAcuity: 3, occupiedBy: null },
    { id: "FT-2", kind: "fast-track", minAcuity: 3, occupiedBy: null },
    { id: "FT-3", kind: "fast-track", minAcuity: 3, occupiedBy: "held: cleaning" },
    { id: "FT-4", kind: "fast-track", minAcuity: 3, occupiedBy: null },
  ];
}

// ---------------------------------------------------------------------------
// Synthetic historical arrivals for the surge forecast (stretch module 5)
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the forecast chart is identical on every reload. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hourly arrival counts for the 24 hours preceding the demo, shaped like a real
 * ED day: an overnight trough, a late-morning ramp, and an early-evening peak.
 */
export function buildHistoricalArrivals(): number[] {
  const rng = mulberry32(20240917);
  // index 0 = 08:00 yesterday ... index 23 = 07:00 today
  const shape = [
    7, 9, 11, 12, 11, 10, 11, 13, 14, 12, 9, 7, 5, 4, 3, 2, 2, 3, 4, 6, 8, 9, 8, 7,
  ];
  return shape.map((mean) => {
    // Poisson-ish jitter via a small sum of uniforms.
    const noise = (rng() + rng() + rng() - 1.5) * Math.sqrt(mean);
    return Math.max(0, Math.round(mean + noise));
  });
}
