import { NextResponse } from "next/server";

import { runScoringSweep, scoreOne, store } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ScoreBody {
  /** Re-score a single patient. Omit to sweep every unscored patient. */
  patientId?: string;
  /** Force a re-score even if the patient already has an AI score. */
  force?: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ScoreBody;

  if (body.patientId) {
    const p = store.patients.find((x) => x.id === body.patientId);
    if (!p) {
      return NextResponse.json({ error: "unknown patientId" }, { status: 404 });
    }
    if (body.force) p.ai = null;
    await scoreOne(body.patientId);
  } else {
    await runScoringSweep();
  }

  return NextResponse.json(await buildDashboardState(), {
    headers: { "cache-control": "no-store" },
  });
}
