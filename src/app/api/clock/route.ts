import { NextResponse } from "next/server";

import { formatSimTime, reanchor, setSimMinutes } from "@/lib/clock";
import { currentSimMinutes, logEvent, store } from "@/lib/store";
import { buildDashboardState } from "@/lib/view";

export const dynamic = "force-dynamic";

interface ClockBody {
  action: "rate" | "jump" | "goto";
  /** simulated minutes per real second, for action "rate" */
  rate?: number;
  /** minutes to jump forward (or back, if negative), for action "jump" */
  minutes?: number;
  /** absolute simulated minute since day start, for action "goto" */
  simMinutes?: number;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ClockBody | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const now = Date.now();
  const before = currentSimMinutes();

  switch (body.action) {
    case "rate": {
      const rate = Number(body.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 120) {
        return NextResponse.json(
          { error: "rate must be between 0 and 120 sim-minutes per real second" },
          { status: 400 },
        );
      }
      store.clock = reanchor(store.clock, now, { rate });
      logEvent(
        "clock",
        rate === 0
          ? `Simulation paused at ${formatSimTime(before)}`
          : `Simulation running at ${Math.round(rate * 60)}× real time`,
      );
      break;
    }
    case "jump": {
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes)) {
        return NextResponse.json({ error: "minutes must be a number" }, { status: 400 });
      }
      store.clock = reanchor(store.clock, now, { jumpMinutes: minutes });
      logEvent(
        "clock",
        `Fast-forwarded ${minutes >= 0 ? "+" : ""}${Math.round(minutes)} simulated minutes → ${formatSimTime(currentSimMinutes())}`,
      );
      break;
    }
    case "goto": {
      const target = Number(body.simMinutes);
      if (!Number.isFinite(target) || target < 0) {
        return NextResponse.json({ error: "simMinutes must be >= 0" }, { status: 400 });
      }
      store.clock = setSimMinutes(store.clock, now, target);
      logEvent("clock", `Jumped to ${formatSimTime(target)} simulated time`);
      break;
    }
    default:
      return NextResponse.json({ error: `unknown action ${body.action}` }, { status: 400 });
  }

  return NextResponse.json(await buildDashboardState(), {
    headers: { "cache-control": "no-store" },
  });
}
