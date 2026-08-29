import { NextResponse } from "next/server";

import { ensureScoringSweep } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The dashboard's single poll endpoint. The first call also kicks off the
 * background acuity sweep, so scores stream in while the UI is already usable.
 */
export async function GET() {
  ensureScoringSweep();
  const state = await buildDashboardState();
  return NextResponse.json(state, {
    headers: { "cache-control": "no-store" },
  });
}
