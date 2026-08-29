/**
 * Stretch module 6 — flow routing.
 *
 * Greedy match: walk the queue in current-urgency order and give each patient
 * the least-capable bed that is still appropriate for their acuity, so that a
 * resus bay is not consumed by an ESI-3 while an ESI-1 is still waiting.
 *
 * Mock beds, mock specialists, no scheduling optimality claimed.
 */

import type { Bed, PatientSnapshot } from "./types";

export interface RoutingAssignment {
  patientId: string;
  patientName: string;
  bedId: string;
  bedKind: Bed["kind"];
  acuity: number;
  urgency: number;
  specialist: string;
}

export interface RoutingResult {
  assignments: RoutingAssignment[];
  unplaced: { patientId: string; patientName: string; reason: string }[];
  bedsFree: number;
  bedsTotal: number;
}

const SPECIALIST_BY_KIND: Record<Bed["kind"], string> = {
  resus: "Resus team + senior EM physician",
  acute: "EM physician",
  "fast-track": "Advanced nurse practitioner",
};

export function routePatients(
  queue: PatientSnapshot[],
  beds: Bed[],
): RoutingResult {
  const available = beds
    .filter((b) => b.occupiedBy === null)
    // Least-capable-first so high-capability bays survive for sicker patients.
    .sort((a, b) => b.minAcuity - a.minAcuity);

  const taken = new Set<string>();
  const assignments: RoutingAssignment[] = [];
  const unplaced: RoutingResult["unplaced"] = [];

  for (const p of queue) {
    if (p.assignedBed) continue;
    // A bay is appropriate when it can handle acuity at least as urgent as the
    // patient's. `available` is sorted least-capable-first, so this picks the
    // lowest-capability appropriate bay.
    const bed = available.find(
      (b) => !taken.has(b.id) && p.effectiveAcuity >= b.minAcuity,
    );
    if (!bed) {
      unplaced.push({
        patientId: p.id,
        patientName: p.name,
        reason:
          available.length === taken.size
            ? "No beds free"
            : `No free bay appropriate for ESI ${p.effectiveAcuity}`,
      });
      continue;
    }
    taken.add(bed.id);
    assignments.push({
      patientId: p.id,
      patientName: p.name,
      bedId: bed.id,
      bedKind: bed.kind,
      acuity: p.effectiveAcuity,
      urgency: p.urgency,
      specialist: SPECIALIST_BY_KIND[bed.kind],
    });
  }

  return {
    assignments,
    unplaced,
    bedsFree: available.length - taken.size,
    bedsTotal: beds.length,
  };
}
