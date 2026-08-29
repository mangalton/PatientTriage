/**
 * The single payload the dashboard polls. Assembled server-side so the client
 * never has to know about the urgency formula, the LLM, or the clock anchor.
 */

import { buildAnalysisReport, type AnalysisReport } from "./analysis";
import { buildEquityReport } from "./equity";
import { routePatients, type RoutingResult } from "./flow";
import { buildSurgeReport } from "./surge";
import {
  currentSimMinutes,
  snapshot,
  store,
} from "./store";
import { checkOllama, type OllamaStatus } from "./ollama";
import {
  ESCALATION_THRESHOLD,
  CRITICAL_THRESHOLD,
  WATCH_THRESHOLD,
  ATYPICAL_BOOST,
  ATYPICAL_RATE_MULTIPLIER,
  AMBIENT_BOOST,
  PHYSIOLOGY_WEIGHT,
  MAX_WAIT_PRESSURE,
  BASE_PER_LEVEL,
  ESCALATION_RATE_PER_MIN,
  URGENCY_MAX,
} from "./urgency";
import {
  STORY_DETERIORATION_PATIENT_ID,
  STORY_EQUITY_GROUP,
} from "./seed";
import type {
  AuditEvent,
  Bed,
  EquityReport,
  OverrideRecord,
  PatientSnapshot,
  SurgeReport,
} from "./types";

export interface DashboardState {
  simMinutes: number;
  rate: number;
  patients: PatientSnapshot[];
  overrides: OverrideRecord[];
  events: AuditEvent[];
  beds: Bed[];
  equity: EquityReport;
  analysis: AnalysisReport;
  surge: SurgeReport;
  routing: RoutingResult;
  ollama: OllamaStatus | null;
  scoringInFlight: number;
  scoredCount: number;
  totalPatients: number;
  constants: typeof URGENCY_CONSTANTS;
  story: { deteriorationPatientId: string; equityGroup: string };
}

export const URGENCY_CONSTANTS = {
  basePerLevel: BASE_PER_LEVEL,
  escalationRatePerMin: ESCALATION_RATE_PER_MIN,
  atypicalBoost: ATYPICAL_BOOST,
  atypicalRateMultiplier: ATYPICAL_RATE_MULTIPLIER,
  ambientBoost: AMBIENT_BOOST,
  physiologyWeight: PHYSIOLOGY_WEIGHT,
  maxWaitPressure: MAX_WAIT_PRESSURE,
  urgencyMax: URGENCY_MAX,
  watchThreshold: WATCH_THRESHOLD,
  escalationThreshold: ESCALATION_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
};

/** Ollama status is cached briefly so a 1 Hz poll doesn't hammer the daemon. */
let ollamaCache: { at: number; status: OllamaStatus } | null = null;

async function getOllamaStatus(): Promise<OllamaStatus | null> {
  const now = Date.now();
  if (ollamaCache && now - ollamaCache.at < 10_000) return ollamaCache.status;
  try {
    const status = await checkOllama();
    ollamaCache = { at: now, status };
    return status;
  } catch {
    return ollamaCache?.status ?? null;
  }
}

export async function buildDashboardState(): Promise<DashboardState> {
  const simMinutes = currentSimMinutes();
  const patients = snapshot(simMinutes);

  return {
    simMinutes: Math.round(simMinutes * 10) / 10,
    rate: store.clock.rate,
    patients,
    overrides: [...store.overrides].sort((a, b) => b.atSimMinutes - a.atSimMinutes),
    events: store.events.slice(0, 120),
    beds: store.beds,
    equity: buildEquityReport(patients, store.overrides, simMinutes),
    analysis: buildAnalysisReport(patients),
    surge: buildSurgeReport(store.history, simMinutes),
    routing: routePatients(patients, store.beds),
    ollama: await getOllamaStatus(),
    scoringInFlight: store.patients.filter((p) => p.scoring).length,
    scoredCount: store.patients.filter((p) => p.ai).length,
    totalPatients: store.patients.length,
    constants: URGENCY_CONSTANTS,
    story: {
      deteriorationPatientId: STORY_DETERIORATION_PATIENT_ID,
      equityGroup: STORY_EQUITY_GROUP,
    },
  };
}
