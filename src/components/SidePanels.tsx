"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatSimTime } from "@/lib/clock";
import type { AuditEvent, Bed, SurgeReport } from "@/lib/types";
import type { RoutingResult } from "@/lib/flow";
import { Card, Empty, Pill, cx, CHART_TOOLTIP, CHART } from "./ui";

// ---------------------------------------------------------------------------
// Stretch module 5 — surge forecast
// ---------------------------------------------------------------------------

export function SurgePanel({ surge }: { surge: SurgeReport }) {
  const t = CHART;
  const overCapacity = surge.nextHourForecast > surge.staffedCapacityPerHour;

  return (
    <Card
      title="Surge forecast"
      subtitle={`${surge.windowSize}-hour moving average over synthetic historical arrivals, with Poisson prediction bounds (λ ± 1.96√λ).`}
      right={
        <Pill tone={overCapacity ? "red" : "green"}>
          next hour ≈ {surge.nextHourForecast} arrivals
        </Pill>
      }
    >
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={surge.points}
            margin={{ top: 6, right: 8, bottom: 0, left: -26 }}
          >
            <defs>
              <linearGradient id="surgeBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.blue} stopOpacity={0.18} />
                <stop offset="100%" stopColor={t.blue} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: t.label, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={1}
            />
            <YAxis
              tick={{ fill: t.label, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: t.axis, strokeWidth: 1 }}
              contentStyle={CHART_TOOLTIP}
            />
            <Area
              dataKey="upper"
              stroke="none"
              fill="url(#surgeBand)"
              isAnimationActive={false}
              name="upper bound"
            />
            <Area
              dataKey="lower"
              stroke="none"
              fill={t.paneMask}
              fillOpacity={1}
              isAnimationActive={false}
              name="lower bound"
            />
            <ReferenceLine
              y={surge.staffedCapacityPerHour}
              stroke={t.red}
              strokeDasharray="4 4"
              label={{
                value: "staffed capacity",
                fill: t.red,
                fontSize: 9,
                position: "insideTopLeft",
              }}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke={t.strong}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              name="actual arrivals"
            />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke={t.blue}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              name="forecast"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-caption leading-[16px] text-label-2">
        White = observed synthetic arrivals, blue dashed = forecast, shaded band =
        95% Poisson interval.{" "}
        {surge.breachHours.length > 0 ? (
          <span className="text-sys-orange">
            The upper bound exceeds staffed capacity in {surge.breachHours.length}{" "}
            of the next 6 hours — the signal a charge nurse would use to pull in
            cover early.
          </span>
        ) : (
          "Forecast stays inside staffed capacity for the next 6 hours."
        )}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stretch module 6 — flow routing
// ---------------------------------------------------------------------------

const BED_KIND_TONE: Record<Bed["kind"], "red" | "orange" | "blue"> = {
  resus: "red",
  acute: "orange",
  "fast-track": "blue",
};

export function FlowPanel({
  routing,
  beds,
}: {
  routing: RoutingResult;
  beds: Bed[];
}) {
  return (
    <Card
      title="Flow routing"
      subtitle="Greedy match of the live queue onto mock bays: each patient takes the least-capable bay still appropriate for their acuity, so resus stays free for the sickest."
      right={
        <Pill tone={routing.bedsFree > 0 ? "green" : "red"}>
          {routing.bedsFree}/{routing.bedsTotal} bays free
        </Pill>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {beds.map((b) => {
          const assigned = routing.assignments.find((a) => a.bedId === b.id);
          return (
            <div
              key={b.id}
              title={
                b.occupiedBy
                  ? `${b.id} — ${b.occupiedBy}`
                  : assigned
                    ? `${b.id} — would take ${assigned.patientName} (ESI ${assigned.acuity})`
                    : `${b.id} — free`
              }
              className={cx(
                "rounded-chip px-2 py-1 text-caption font-medium",
                b.occupiedBy
                  ? "bg-fill text-label-3 line-through"
                  : assigned
                    ? "bg-tint-blue text-sys-blue"
                    : "bg-tint-green text-sys-green",
              )}
            >
              {b.id}
            </div>
          );
        })}
      </div>

      {routing.assignments.length === 0 ? (
        <Empty>No bays available to assign.</Empty>
      ) : (
        <ol className="overflow-hidden rounded-card glass-soft">
          {routing.assignments.map((a, i) => (
            <li
              key={a.bedId}
              className={cx(
                "flex items-center gap-2.5 px-3 py-2",
                i !== routing.assignments.length - 1 && "border-b border-sep",
              )}
            >
              <span className="tnum w-3.5 text-caption text-label-3">{i + 1}</span>
              <Pill tone={BED_KIND_TONE[a.bedKind]}>{a.bedId}</Pill>
              <span className="min-w-0 flex-1 truncate text-footnote font-medium text-label">
                {a.patientName}
              </span>
              <span className="tnum text-caption text-label-2">
                ESI {a.acuity} · urgency {a.urgency.toFixed(0)}
              </span>
              <span className="hidden truncate text-caption text-label-3 sm:inline">
                {a.specialist}
              </span>
            </li>
          ))}
        </ol>
      )}

      {routing.unplaced.length > 0 && (
        <p className="mt-3 text-caption text-sys-orange">
          {routing.unplaced.length} patient
          {routing.unplaced.length === 1 ? "" : "s"} could not be placed —{" "}
          {routing.unplaced[0].reason.toLowerCase()}.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

const EVENT_TONE: Record<
  AuditEvent["kind"],
  "gray" | "red" | "orange" | "green" | "blue" | "indigo"
> = {
  llm_request: "gray",
  llm_response: "green",
  llm_error: "red",
  llm_fallback: "orange",
  override: "indigo",
  clock: "blue",
  seed: "gray",
  routing: "gray",
};

export function AuditLog({ events }: { events: AuditEvent[] }) {
  return (
    <Card
      title="Audit trail"
      subtitle="Every model request, response, fallback, override, and clock change. Expand a row to see the raw request/response payload."
      right={<Pill>{events.length} events</Pill>}
    >
      {events.length === 0 ? (
        <Empty>No events yet.</Empty>
      ) : (
        <ol className="max-h-[420px] overflow-y-auto overflow-x-hidden rounded-card glass-soft">
          {events.map((e, i) => (
            <li
              key={e.id}
              className={cx(i !== events.length - 1 && "border-b border-sep")}
            >
              <details className="group">
                <summary
                  className={cx(
                    "flex list-none items-center gap-2 px-3 py-2 transition-colors",
                    e.detail ? "cursor-pointer hover:bg-fill" : "cursor-default",
                  )}
                >
                  {e.detail ? (
                    <svg
                      viewBox="0 0 8 12"
                      className="h-2 w-2 shrink-0 fill-label-3 transition-transform duration-200 group-open:rotate-90"
                      aria-hidden
                    >
                      <path d="M1 0l6 6-6 6z" />
                    </svg>
                  ) : (
                    <span className="w-2 shrink-0" />
                  )}
                  <span className="tnum shrink-0 text-caption text-label-3">
                    {formatSimTime(e.atSimMinutes)}
                  </span>
                  <Pill tone={EVENT_TONE[e.kind]}>{e.kind.replace("_", " ")}</Pill>
                  <span className="min-w-0 flex-1 text-caption leading-[16px] text-label-2">
                    {e.summary}
                  </span>
                </summary>
                {e.detail !== undefined && (
                  <pre className="max-h-64 overflow-auto border-t border-sep bg-fill px-3 py-2.5 font-mono text-caption2 leading-[15px] text-label-2">
                    {JSON.stringify(e.detail, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
