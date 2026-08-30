/**
 * In-memory demo store.
 *
 * A module-level singleton behind a globalThis guard so Next.js dev-mode hot
 * reloads don't reseed the department mid-demo. Nothing is persisted to disk:
 * the data is synthetic, and a fresh process should always start from the same
 * reproducible seed.
 *
 * The store holds only *facts* (who arrived, what the model said, what a nurse
 * did). Everything time-dependent — current vitals, NEWS, urgency, rank — is
 * derived on read at the current simulated minute by `snapshot()`.
 */

import { simMinutesAt } from "./clock";
import { AGE_BAND_CHART, adultChartScore, ageBandFor, earlyWarningScore, ewsBand } from "./ews";
import {
  INITIAL_SIM_MINUTES,
  SEED_PATIENTS,
  buildBeds,
  buildHistoricalArrivals,
  buildPatients,
  clampAcuity,
  SURGE_PATIENTS,
} from "./seed";
import { scorePatient } from "./scorer";
import {
  computeUrgency,
  escalationStatus,
  findEscalationCrossing,
  projectVitals,
  SAFE_WAIT_MINUTES,
  VITALS_STALE_AFTER_MINUTES,
} from "./urgency";
import type {
  AcuityLevel,
  AuditEvent,
  DataCompleteness,
  Bed,
  ClockState,
  OverrideRecord,
  Patient,
  PatientSnapshot,
} from "./types";

interface Store {
  patients: Patient[];
  overrides: OverrideRecord[];
  events: AuditEvent[];
  beds: Bed[];
  history: number[];
  clock: ClockState;
  /** Guards against kicking off the initial scoring sweep more than once. */
  scoringSweepStarted: boolean;
  /** True once the 3x surge cohort has been admitted. */
  surgeActive: boolean;
  seq: number;
}

function createStore(): Store {
  return {
    patients: buildPatients(),
    overrides: [],
    events: [],
    beds: buildBeds(),
    history: buildHistoricalArrivals(),
    clock: {
      anchorRealMs: Date.now(),
      anchorSimMinutes: INITIAL_SIM_MINUTES,
      rate: 0,
    },
    scoringSweepStarted: false,
    surgeActive: false,
    seq: 0,
  };
}

const globalRef = globalThis as unknown as { __triageStore?: Store };
export const store: Store = (globalRef.__triageStore ??= createStore());

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

const MAX_EVENTS = 400;

export function logEvent(
  kind: AuditEvent["kind"],
  summary: string,
  opts: { patientId?: string; detail?: unknown } = {},
): AuditEvent {
  store.seq += 1;
  const event: AuditEvent = {
    id: `E-${String(store.seq).padStart(4, "0")}`,
    at: new Date().toISOString(),
    atSimMinutes: Math.round(currentSimMinutes()),
    kind,
    patientId: opts.patientId,
    summary,
    detail: opts.detail,
  };
  store.events.unshift(event);
  if (store.events.length > MAX_EVENTS) store.events.length = MAX_EVENTS;
  return event;
}

export function currentSimMinutes(): number {
  return simMinutesAt(store.clock, Date.now());
}

// ---------------------------------------------------------------------------
// Derived view
// ---------------------------------------------------------------------------

/**
 * What we actually know about this patient at intake.
 *
 * Missing information is never treated as reassuring — the score it produces
 * feeds the precautionary uplift, which only ever raises urgency.
 */
export function assessCompleteness(p: Patient): DataCompleteness {
  const missing: string[] = [];
  const hasPriorRecord = p.priorRecord !== null;
  if (!hasPriorRecord) missing.push("prior record");
  if (!p.narrative || p.narrative.length < 40) missing.push("history detail");
  for (const v of p.unobtainableVitals) missing.push(`vital:${v}`);

  // Six expected inputs: prior record, narrative, and four core vital groups.
  const expected = 6;
  const score = Math.max(0, Math.min(1, (expected - missing.length) / expected));

  return {
    score: Math.round(score * 100) / 100,
    missing,
    hasPriorRecord,
    hasFullVitals: p.unobtainableVitals.length === 0,
    zeroHistory: !hasPriorRecord,
  };
}

export function effectiveAcuity(p: Patient): AcuityLevel {
  if (p.overrideAcuity !== null) return p.overrideAcuity;
  if (p.ai) return p.ai.acuity_level;
  // Un-scored patients sit at the middle of the scale rather than at either
  // extreme, so a slow model never silently buries or promotes anyone.
  return 3;
}

/**
 * Build the full derived view of the department at `simMinutes`.
 * Patients who have not arrived yet in simulated time are excluded.
 */
export function snapshot(simMinutes = currentSimMinutes()): PatientSnapshot[] {
  const arrived = store.patients.filter((p) => p.arrivalSimMinutes <= simMinutes);

  const rows = arrived.map((p) => {
    const waitMinutes = Math.max(0, simMinutes - p.arrivalSimMinutes);
    const projected = projectVitals(
      p.arrivalVitals,
      p.trajectory,
      waitMinutes,
      p.id,
    );
    const currentVitals = projected.vitals;

    // Age band decides which early-warning chart applies. Never assume adult.
    const band = ageBandFor(p.age);
    const news = earlyWarningScore(currentVitals, p.age);

    const completeness = assessCompleteness(p);
    const acuity = effectiveAcuity(p);
    const atypical = p.ai?.atypical_presentation_flag ?? false;
    const ambient = p.ambient !== null;
    const riskFactors = p.ai?.risk_factors ?? [];
    const confidence = p.ai?.confidence;

    const urgencyBreakdown = computeUrgency({
      acuity,
      waitMinutes,
      atypical,
      ambient,
      riskFactors,
      age: p.age,
      ageBand: band,
      confidence,
      completeness,
      vitals: currentVitals,
    });

    const urgencyAtArrival = computeUrgency({
      acuity,
      waitMinutes: 0,
      atypical,
      ambient,
      riskFactors,
      age: p.age,
      ageBand: band,
      confidence,
      completeness,
      vitals: p.arrivalVitals,
    }).total;

    const crossing = findEscalationCrossing({
      arrivalVitals: p.arrivalVitals,
      trajectory: p.trajectory,
      acuity,
      atypical,
      ambient,
      age: p.age,
      ageBand: band,
      riskFactors,
      confidence,
      completeness,
    });

    // Mandatory re-assessment when a patient has waited longer than their
    // acuity level safely permits. This is a hard time trigger, independent of
    // whether their score happens to have drifted upward.
    const reassessDueAtMinutes = SAFE_WAIT_MINUTES[acuity];
    const overdueBy = Math.round(waitMinutes - reassessDueAtMinutes);

    return {
      ...p,
      currentVitals,
      ageBand: band,
      ewsChart: AGE_BAND_CHART[band],
      adultChartNews: adultChartScore(currentVitals),
      completeness,
      vitalsAgeMinutes: Math.round(projected.ageMinutes),
      vitalsStale: projected.ageMinutes >= VITALS_STALE_AFTER_MINUTES,
      waitMinutes: Math.round(waitMinutes),
      news,
      newsBand: ewsBand(news),
      effectiveAcuity: acuity,
      urgency: urgencyBreakdown.total,
      urgencyAtArrival,
      urgencyBreakdown,
      status: escalationStatus(urgencyBreakdown.total),
      escalationCrossedAtMinutes:
        crossing !== null && crossing <= waitMinutes ? crossing : null,
      reassessDueAtMinutes,
      reassessOverdue: overdueBy > 0,
      reassessOverdueByMinutes: Math.max(0, overdueBy),
      rank: 0,
      rankDelta: 0,
    } satisfies PatientSnapshot;
  });

  // Current queue order.
  const byUrgency = [...rows].sort(
    (a, b) => b.urgency - a.urgency || a.arrivalSimMinutes - b.arrivalSimMinutes,
  );
  byUrgency.forEach((row, i) => {
    row.rank = i + 1;
  });

  // Where the same cohort would have sat under a static intake score, so the UI
  // can show "moved up 6 places since arrival" — the core claim of the demo.
  const byArrivalUrgency = [...rows].sort(
    (a, b) =>
      b.urgencyAtArrival - a.urgencyAtArrival ||
      a.arrivalSimMinutes - b.arrivalSimMinutes,
  );
  const arrivalRank = new Map<string, number>();
  byArrivalUrgency.forEach((row, i) => arrivalRank.set(row.id, i + 1));
  for (const row of byUrgency) {
    row.rankDelta = (arrivalRank.get(row.id) ?? row.rank) - row.rank;
  }

  return byUrgency;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Cap concurrent local-model calls; an 8B model on a laptop hates parallelism. */
const SCORING_CONCURRENCY = Number(process.env.SCORING_CONCURRENCY ?? 2);

export async function scoreOne(patientId: string): Promise<void> {
  const p = store.patients.find((x) => x.id === patientId);
  if (!p || p.scoring) return;

  p.scoring = true;
  p.scoringError = null;
  logEvent("llm_request", `Requesting acuity assessment for ${p.id} ${p.name}`, {
    patientId: p.id,
  });

  try {
    const { score, attempts } = await scorePatient(p);
    p.ai = score;
    p.scoringError = null;

    for (const a of attempts) {
      if (a.error) {
        logEvent("llm_error", `${p.id} attempt ${a.attempt} failed: ${a.error}`, {
          patientId: p.id,
          detail: a,
        });
      }
    }

    if (score.source === "heuristic-fallback") {
      logEvent(
        "llm_fallback",
        `${p.id} scored by rule-based fallback (local model unavailable) → ESI ${score.acuity_level}`,
        { patientId: p.id, detail: score },
      );
    } else {
      logEvent(
        "llm_response",
        `${p.id} scored ESI ${score.acuity_level} (confidence ${score.confidence}${
          score.atypical_presentation_flag ? ", ATYPICAL FLAG" : ""
        }) in ${score.latencyMs}ms by ${score.model}`,
        { patientId: p.id, detail: { score, attempts } },
      );
    }

    applySeededOverride(p);
  } catch (err) {
    p.scoringError = err instanceof Error ? err.message : String(err);
    logEvent("llm_error", `${p.id} scoring failed: ${p.scoringError}`, {
      patientId: p.id,
    });
  } finally {
    p.scoring = false;
  }
}

/**
 * Seeded overrides are stored as a delta against whatever the model assigned,
 * so the "historical shift data" narrative survives model non-determinism.
 * Applied exactly once, immediately after the patient's first score lands.
 */
function applySeededOverride(p: Patient): void {
  const seed = SEED_PATIENTS.find((s) => s.id === p.id);
  if (!seed?.seededOverride || !p.ai) return;
  if (store.overrides.some((o) => o.patientId === p.id && o.seeded)) return;

  const from = p.ai.acuity_level;
  const to = clampAcuity(from + seed.seededOverride.delta);
  if (to === from) return; // Clamped away at the ends of the scale.

  p.overrideAcuity = to;
  store.seq += 1;
  store.overrides.push({
    id: `O-${String(store.seq).padStart(4, "0")}`,
    patientId: p.id,
    fromAcuity: from,
    toAcuity: to,
    direction: to > from ? "downgrade" : "upgrade",
    reason: seed.seededOverride.reason,
    nurse: seed.seededOverride.nurse,
    atSimMinutes: seed.arrivalSimMinutes + seed.seededOverride.afterArrivalMinutes,
    seeded: true,
  });
  logEvent(
    "override",
    `[seeded] ${seed.seededOverride.nurse} ${to > from ? "downgraded" : "upgraded"} ${p.id} from ESI ${from} to ESI ${to}: "${seed.seededOverride.reason}"`,
    { patientId: p.id },
  );
}

/** Score every unscored patient, a couple at a time. Fire-and-forget. */
export async function runScoringSweep(): Promise<void> {
  const pending = store.patients.filter((p) => !p.ai && !p.scoring);
  const queue = [...pending];

  const workers = Array.from({ length: SCORING_CONCURRENCY }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await scoreOne(next.id);
    }
  });

  await Promise.all(workers);
}

export function ensureScoringSweep(): void {
  if (store.scoringSweepStarted) return;
  store.scoringSweepStarted = true;
  logEvent("seed", `Seeded ${store.patients.length} synthetic patients; starting acuity sweep`);
  void runScoringSweep().catch((err) => {
    logEvent("llm_error", `Scoring sweep failed: ${String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function recordOverride(
  patientId: string,
  toAcuity: AcuityLevel,
  reason: string,
  nurse = "RN (demo user)",
): OverrideRecord | null {
  const p = store.patients.find((x) => x.id === patientId);
  if (!p) return null;

  const from = effectiveAcuity(p);
  if (from === toAcuity) return null;

  p.overrideAcuity = toAcuity;
  store.seq += 1;
  const record: OverrideRecord = {
    id: `O-${String(store.seq).padStart(4, "0")}`,
    patientId,
    fromAcuity: from,
    toAcuity,
    direction: toAcuity > from ? "downgrade" : "upgrade",
    reason: reason.trim() || "(no reason given)",
    nurse,
    atSimMinutes: Math.round(currentSimMinutes()),
    seeded: false,
  };
  store.overrides.push(record);
  logEvent(
    "override",
    `${nurse} ${record.direction}d ${patientId} from ESI ${from} to ESI ${toAcuity}: "${record.reason}"`,
    { patientId, detail: record },
  );
  return record;
}

/** Accept the AI score, clearing any override in force. */
export function acceptAiScore(patientId: string): void {
  const p = store.patients.find((x) => x.id === patientId);
  if (!p || !p.ai) return;
  if (p.overrideAcuity === null) return;
  const from = p.overrideAcuity;
  p.overrideAcuity = null;
  logEvent(
    "override",
    `Override on ${patientId} reverted (ESI ${from} → AI score ESI ${p.ai.acuity_level})`,
    { patientId },
  );
}

/**
 * Admit the surge cohort — the brief's 3x volume scenario.
 *
 * Deliberately does NOT change any threshold, weight or scoring rule. A
 * patient's physiology is indifferent to how busy the department is, and
 * relaxing thresholds under load is how a system begins under-triaging exactly
 * when the consequences are worst. What surge changes is what the department
 * can SEE: how many patients are past the wait their acuity safely permits, and
 * how far demand now exceeds staffed capacity.
 */
export async function activateSurge(): Promise<void> {
  if (store.surgeActive) return;
  store.surgeActive = true;

  const extra = buildPatients(true).filter((p) =>
    SURGE_PATIENTS.some((sp) => sp.id === p.id),
  );
  store.patients.push(...extra);

  logEvent(
    "seed",
    `SURGE: ${extra.length} additional arrivals admitted over ${
      Math.max(...SURGE_PATIENTS.map((p) => p.arrivalSimMinutes)) -
      Math.min(...SURGE_PATIENTS.map((p) => p.arrivalSimMinutes))
    } simulated minutes (roughly 3x the normal arrival rate). No scoring threshold was changed.`,
  );

  await runScoringSweep();
}

export function resetStore(): void {
  const fresh = createStore();
  Object.assign(store, fresh);
  logEvent("seed", "Department reset to the seeded synthetic cohort");
}
