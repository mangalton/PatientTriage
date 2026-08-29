/**
 * Simulated ED clock.
 *
 * A demo can't wait four real hours to show a four-hour wait, so all wait times
 * are measured in *simulated* minutes since ED day start (08:00). The clock is
 * an anchor plus a rate, so it advances continuously without a server timer:
 *
 *   simMinutes(now) = anchorSimMinutes + (now - anchorRealMs)/1000 * rate
 *
 * `rate` is simulated minutes per real second. rate = 0 is paused, rate = 1 is
 * real time, rate = 60 makes one real second equal one simulated minute.
 */

import { DAY_START_HOUR } from "./seed";
import type { ClockState } from "./types";

export const RATE_PRESETS = [
  { label: "Paused", value: 0 },
  { label: "1×", value: 1 / 60 },
  { label: "60×", value: 1 },
  { label: "300×", value: 5 },
] as const;

export function simMinutesAt(clock: ClockState, nowMs: number): number {
  if (clock.rate === 0) return clock.anchorSimMinutes;
  const elapsedRealSeconds = (nowMs - clock.anchorRealMs) / 1000;
  return clock.anchorSimMinutes + elapsedRealSeconds * clock.rate;
}

/** Re-anchor the clock at the current simulated time, then apply a mutation. */
export function reanchor(
  clock: ClockState,
  nowMs: number,
  patch: Partial<Pick<ClockState, "rate">> & { jumpMinutes?: number },
): ClockState {
  const current = simMinutesAt(clock, nowMs);
  return {
    anchorRealMs: nowMs,
    anchorSimMinutes: Math.max(0, current + (patch.jumpMinutes ?? 0)),
    rate: patch.rate ?? clock.rate,
  };
}

export function setSimMinutes(
  clock: ClockState,
  nowMs: number,
  simMinutes: number,
): ClockState {
  return {
    anchorRealMs: nowMs,
    anchorSimMinutes: Math.max(0, simMinutes),
    rate: clock.rate,
  };
}

/** "10:47" style label for a simulated minute offset from day start. */
export function formatSimTime(simMinutes: number): string {
  const total = Math.floor(simMinutes);
  const hour = (DAY_START_HOUR + Math.floor(total / 60)) % 24;
  const minute = ((total % 60) + 60) % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "1h 47m" / "23m" style duration label. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
