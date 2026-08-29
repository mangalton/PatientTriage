import { NextResponse } from "next/server";

import { acceptAiScore, recordOverride } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";
import type { AcuityLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

interface OverrideBody {
  patientId: string;
  /** Omit (or send null) together with accept:true to revert to the AI score. */
  acuity?: number;
  reason?: string;
  nurse?: string;
  accept?: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as OverrideBody | null;
  if (!body?.patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  if (body.accept) {
    acceptAiScore(body.patientId);
    return NextResponse.json(await buildDashboardState(), {
      headers: { "cache-control": "no-store" },
    });
  }

  const acuity = Number(body.acuity);
  if (!Number.isInteger(acuity) || acuity < 1 || acuity > 5) {
    return NextResponse.json(
      { error: "acuity must be an integer from 1 to 5" },
      { status: 400 },
    );
  }

  const record = recordOverride(
    body.patientId,
    acuity as AcuityLevel,
    body.reason ?? "",
    body.nurse?.trim() || undefined,
  );
  if (!record) {
    return NextResponse.json(
      { error: "no change — patient not found, or already at that acuity" },
      { status: 409 },
    );
  }

  return NextResponse.json(await buildDashboardState(), {
    headers: { "cache-control": "no-store" },
  });
}
