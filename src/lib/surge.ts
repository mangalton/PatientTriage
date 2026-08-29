/**
 * Stretch module 5 — surge prediction.
 *
 * A 4-hour centred-trailing moving average over synthetic hourly arrivals, with
 * Poisson prediction bounds (λ ± 1.96·√λ). Deliberately the simplest forecast
 * that is still honest: arrivals are counts, counts are Poisson-ish, and the
 * variance of a Poisson is its mean, so the interval falls straight out of the
 * point estimate with no fitting.
 *
 * Synthetic history only. This is not calibrated against any real ED.
 */

import { DAY_START_HOUR } from "./seed";
import type { SurgePoint, SurgeReport } from "./types";

export const MA_WINDOW = 4;
/** Mock staffing: how many arrivals per hour the department can absorb. */
export const STAFFED_CAPACITY_PER_HOUR = 11;

function movingAverage(series: number[], index: number, window: number): number {
  const start = Math.max(0, index - window);
  const slice = series.slice(start, index);
  if (!slice.length) return series[0] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function buildSurgeReport(
  history: number[],
  simMinutes: number,
): SurgeReport {
  // history[0] is the hour beginning at DAY_START_HOUR yesterday; the tail of
  // `history` is extended with today's elapsed hours so the "now" marker in the
  // chart tracks the simulated clock.
  const elapsedHoursToday = Math.max(0, Math.floor(simMinutes / 60));
  const points: SurgePoint[] = [];

  // Show the last 12 hours of history plus 6 hours of forecast.
  const historyStart = Math.max(0, history.length - 12);
  const projected = [...history];

  for (let i = historyStart; i < history.length + 6; i += 1) {
    const isHistory = i < history.length;
    const lambda = Math.max(0.5, movingAverage(projected, i, MA_WINDOW));

    if (!isHistory) {
      // Feed the forecast back in so the moving average can keep walking forward.
      projected[i] = lambda;
    }

    const hourOfDay = (DAY_START_HOUR + i) % 24;
    points.push({
      hour: i,
      label: `${String(hourOfDay).padStart(2, "0")}:00`,
      actual: isHistory ? history[i] : null,
      forecast: Math.round(lambda * 10) / 10,
      lower: Math.max(0, Math.round((lambda - 1.96 * Math.sqrt(lambda)) * 10) / 10),
      upper: Math.round((lambda + 1.96 * Math.sqrt(lambda)) * 10) / 10,
    });
  }

  const forecastPoints = points.filter((p) => p.actual === null);
  const breachHours = forecastPoints
    .filter((p) => p.upper > STAFFED_CAPACITY_PER_HOUR)
    .map((p) => p.hour);

  return {
    points,
    windowSize: MA_WINDOW,
    nextHourForecast: forecastPoints[0]?.forecast ?? 0,
    staffedCapacityPerHour: STAFFED_CAPACITY_PER_HOUR,
    breachHours,
    nowHour: history.length - 1 + elapsedHoursToday,
  };
}
