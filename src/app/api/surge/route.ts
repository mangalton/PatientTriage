import { NextResponse } from "next/server";

import { activateSurge } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Admit the surge cohort — 12 extra arrivals inside ~11 simulated minutes,
 * roughly three times the normal arrival rate.
 *
 * No scoring threshold, weight or rule changes. See `activateSurge` for why
 * that is deliberate.
 */
export async function POST() {
  await activateSurge();
  return NextResponse.json(await buildDashboardState(), {
    headers: { "cache-control": "no-store" },
  });
}
