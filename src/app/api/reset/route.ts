import { NextResponse } from "next/server";

import { ensureScoringSweep, resetStore } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";

export const dynamic = "force-dynamic";

/** Reseed the department back to the reproducible synthetic cohort. */
export async function POST() {
  resetStore();
  ensureScoringSweep();
  return NextResponse.json(await buildDashboardState(), {
    headers: { "cache-control": "no-store" },
  });
}
