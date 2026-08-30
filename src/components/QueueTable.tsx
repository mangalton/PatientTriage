"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatDuration } from "@/lib/clock";
import type { PatientSnapshot } from "@/lib/types";
import type { DashboardState } from "@/lib/view";
import {
  AcuityBadge,
  Card,
  Empty,
  Meter,
  Pill,
  STATUS_STYLE,
  Skeleton,
  cx,
} from "./ui";

type SortKey = "urgency" | "wait" | "acuity" | "news" | "arrival";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "urgency", label: "Current urgency" },
  { key: "acuity", label: "Static acuity (intake)" },
  { key: "wait", label: "Wait time" },
  { key: "news", label: "NEWS" },
  { key: "arrival", label: "Arrival order" },
];

function sortRows(rows: PatientSnapshot[], key: SortKey): PatientSnapshot[] {
  const copy = [...rows];
  switch (key) {
    case "urgency":
      return copy.sort((a, b) => b.urgency - a.urgency);
    case "acuity":
      return copy.sort(
        (a, b) =>
          a.effectiveAcuity - b.effectiveAcuity ||
          a.arrivalSimMinutes - b.arrivalSimMinutes,
      );
    case "wait":
      return copy.sort((a, b) => b.waitMinutes - a.waitMinutes);
    case "news":
      return copy.sort((a, b) => b.news - a.news);
    case "arrival":
      return copy.sort((a, b) => a.arrivalSimMinutes - b.arrivalSimMinutes);
  }
}

/**
 * FLIP the queue rows so a re-sort reads as movement rather than a jump cut.
 *
 * Watching a patient *climb* is the entire point of this prototype, and a row
 * that teleports communicates nothing. We record each row's layout position and,
 * after React commits the new order, invert the delta and release it.
 *
 * `offsetTop` is layout, not paint, so it stays correct even while a previous
 * glide is still transforming the row — no need to wait for animations to settle
 * before measuring again. The easing lives in the `.row-glide` class; only the
 * measured per-row delta is set from JS, because no utility class can express it.
 */
function useQueueFlip(orderKey: string) {
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const lastTop = useRef(new Map<string, number>());

  const register = useCallback(
    (id: string) => (el: HTMLTableRowElement | null) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    const moved: { el: HTMLTableRowElement; dy: number }[] = [];

    rows.current.forEach((el, id) => {
      const top = el.offsetTop;
      const prev = lastTop.current.get(id);
      if (prev !== undefined && Math.abs(prev - top) > 1) {
        moved.push({ el, dy: prev - top });
      }
      lastTop.current.set(id, top);
    });

    if (moved.length === 0) return;

    // Invert: snap every moved row back to where it was, with no transition.
    for (const { el, dy } of moved) {
      el.classList.remove("row-glide");
      el.style.transform = `translateY(${dy}px)`;
    }

    // Play: on the next frame, let them glide to their real positions.
    const raf = requestAnimationFrame(() => {
      for (const { el } of moved) {
        el.classList.add("row-glide");
        el.style.transform = "";
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [orderKey]);

  return register;
}

function RankDelta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-label-3">–</span>;
  const up = delta > 0;
  return (
    <span
      className={cx(
        "tnum inline-flex items-center gap-[1px] text-caption font-semibold",
        up ? "text-st-critical" : "text-label-3",
      )}
      title={
        up
          ? `Moved up ${delta} place${delta === 1 ? "" : "s"} since arrival — a static intake score would still have them where they started.`
          : `Moved down ${-delta} place${delta === -1 ? "" : "s"} since arrival.`
      }
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current" aria-hidden>
        {up ? <path d="M5 1.5 9 7H1z" /> : <path d="M5 8.5 1 3h8z" />}
      </svg>
      {Math.abs(delta)}
    </span>
  );
}

const TH = "px-2 py-3 text-caption font-medium text-label-3";
const TD = "px-2 py-3.5";

export function QueueTable({
  state,
  selectedId,
  onSelect,
}: {
  state: DashboardState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const rows = useMemo(
    () => sortRows(state.patients, sortKey),
    [state.patients, sortKey],
  );

  // Re-run the FLIP only when the actual order changes, not on every poll tick.
  const registerRow = useQueueFlip(rows.map((p) => p.id).join(","));

  const escalated = state.patients.filter(
    (p) => p.status === "escalated" || p.status === "critical",
  ).length;
  const awaitingScore = state.patients.filter((p) => !p.ai).length;

  return (
    <Card
      flush
      title="Waiting-room queue"
      subtitle={
        <>
          {state.patients.length} waiting · {escalated} at or above the escalation
          threshold ({state.constants.escalationThreshold} urgency points). Sorted by{" "}
          <span className="font-medium text-label">
            {SORTS.find((s) => s.key === sortKey)!.label.toLowerCase()}
          </span>
          .
        </>
      }
      right={
        <div className="relative">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="cursor-pointer appearance-none rounded-capsule bg-fill py-[7px] pl-3.5 pr-8 text-footnote font-medium text-label transition-colors duration-200 hover:bg-fill2 focus:outline-none"
            aria-label="Sort queue by"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 10 14"
            className="pointer-events-none absolute right-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 fill-label-3"
            aria-hidden
          >
            <path d="M5 0 8 4H2zM5 14 2 10h6z" />
          </svg>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty
          icon={
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-none stroke-current"
              strokeWidth={1.7}
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h9" />
            </svg>
          }
          hint="Nobody has arrived yet at the current simulated time. Advance the clock, or press Reset demo to reseed the department."
        >
          The waiting room is empty
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-sep text-left">
                <th className={cx(TH, "pl-5")}>#</th>
                <th className={TH}>Δ</th>
                <th className={TH}>Patient</th>
                <th
                  className={TH}
                  title="Effective ESI acuity level (nurse override takes precedence over the model)"
                >
                  ESI
                </th>
                <th className={TH}>Chief complaint</th>
                <th className={cx(TH, "text-right")}>Wait</th>
                <th
                  className={cx(TH, "text-right")}
                  title="National Early Warning Score computed from current simulated vitals"
                >
                  NEWS
                </th>
                <th className={TH}>Current urgency</th>
                <th className={cx(TH, "pr-5")}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const s = STATUS_STYLE[p.status];
                const crossed = p.escalationCrossedAtMinutes !== null;
                const selected = selectedId === p.id;
                const alarming =
                  p.status === "critical" || p.status === "escalated";

                return (
                  <tr
                    key={p.id}
                    ref={registerRow(p.id)}
                    onClick={() => onSelect(p.id)}
                    className={cx(
                      "group relative cursor-pointer transition-colors duration-200",
                      i !== rows.length - 1 && "border-b border-sep",
                      selected ? "bg-tint-blue" : s.row,
                    )}
                  >
                    {/* Rank + severity rail */}
                    <td className="relative py-3.5 pl-5 pr-2">
                      {s.accent && (
                        <span
                          className={cx(
                            "absolute left-0 top-0 h-full rounded-r-full",
                            s.rail,
                            s.accent,
                          )}
                          aria-hidden
                        />
                      )}
                      <span
                        className={cx(
                          "tnum text-footnote",
                          alarming ? "font-semibold text-label" : "text-label-3",
                        )}
                      >
                        {p.rank}
                      </span>
                    </td>

                    <td className={TD}>
                      <RankDelta delta={p.rankDelta} />
                    </td>

                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cx(
                            "h-[7px] w-[7px] shrink-0 rounded-full",
                            s.dot,
                            p.status === "critical" && "animate-breathe",
                          )}
                          title={s.label}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-subhead font-semibold tracking-[-0.01em] text-label">
                            {p.name}
                          </div>
                          <div className="tnum mt-0.5 text-caption text-label-3">
                            {p.id} · {p.age}
                            {p.sex} · {p.arrivalMode.toLowerCase()}
                            {p.ageBand !== "adult" && (
                              <span className="ml-1 font-medium text-sys-indigo">
                                · {p.ageBand}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className={TD}>
                      {p.ai || p.overrideAcuity !== null ? (
                        <AcuityBadge
                          size="sm"
                          level={p.effectiveAcuity}
                          overridden={p.overrideAcuity !== null}
                        />
                      ) : (
                        <Skeleton className="h-[24px] w-[24px] rounded-chip" />
                      )}
                    </td>

                    <td className={cx(TD, "max-w-[240px]")}>
                      <div className="truncate text-footnote text-label-2">
                        {p.chiefComplaint}
                      </div>
                    </td>

                    <td
                      className={cx(TD, "tnum text-right text-footnote text-label-2")}
                    >
                      {formatDuration(p.waitMinutes)}
                    </td>

                    <td className={cx(TD, "text-right")}>
                      <span
                        className={cx(
                          "tnum text-subhead font-semibold",
                          p.newsBand === "high"
                            ? "text-st-critical"
                            : p.newsBand === "medium"
                              ? "text-st-escalated"
                              : "text-label-3",
                        )}
                      >
                        {p.news}
                      </span>
                    </td>

                    <td className={cx(TD, "w-[168px]")}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cx(
                            "tnum display-tight w-9 text-title3 font-semibold",
                            p.status === "stable" ? "text-label-2" : s.text,
                          )}
                        >
                          {p.urgency.toFixed(0)}
                        </span>
                        <div className="flex-1">
                          <Meter
                            value={p.urgency}
                            max={state.constants.urgencyMax}
                            tone={p.status}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 pl-2 pr-5">
                      {!p.ai && p.scoring ? (
                        <Skeleton className="h-[18px] w-24" />
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {crossed && (
                            <Pill
                              tone={s.pill}
                              title={`Crossed the escalation threshold ${formatDuration(p.waitMinutes - p.escalationCrossedAtMinutes!)} ago`}
                            >
                              escalated
                            </Pill>
                          )}
                          {p.ai?.atypical_presentation_flag && (
                            <Pill
                              tone="red"
                              title={
                                p.ai.atypical_reason ??
                                "Atypical presentation of a potentially serious condition"
                              }
                            >
                              atypical
                            </Pill>
                          )}
                          {p.overrideAcuity !== null && (
                            <Pill
                              tone="indigo"
                              title="A nurse override is in force for this patient"
                            >
                              override
                            </Pill>
                          )}
                          {p.reassessOverdue && (
                            <Pill
                              tone="red"
                              title={`Waited ${formatDuration(p.waitMinutes)} — an ESI ${p.effectiveAcuity} patient may safely wait ${formatDuration(p.reassessDueAtMinutes)}. Mandatory re-assessment is ${formatDuration(p.reassessOverdueByMinutes)} overdue.`}
                            >
                              re-assess {formatDuration(p.reassessOverdueByMinutes)} overdue
                            </Pill>
                          )}
                          {p.completeness.zeroHistory && (
                            <Pill
                              tone="indigo"
                              title="First presentation — nothing on file. Missing history raises urgency; it is never treated as reassurance."
                            >
                              no record
                            </Pill>
                          )}
                          {p.vitalsStale && (
                            <Pill
                              tone="orange"
                              title={`No observations for ${formatDuration(p.vitalsAgeMinutes)} — the physiology term is frozen and this score is running blind`}
                            >
                              obs {formatDuration(p.vitalsAgeMinutes)} old
                            </Pill>
                          )}
                          {p.ambient && (
                            <Pill tone="blue" title={p.ambient.reason}>
                              ambient
                            </Pill>
                          )}
                          {p.ai?.source === "heuristic-fallback" && (
                            <Pill
                              tone="gray"
                              title="Scored by the rule-based fallback, not the local model"
                            >
                              no-LLM
                            </Pill>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {awaitingScore > 0 && (
            <p className="border-t border-sep px-5 py-2.5 text-caption text-label-3">
              {awaitingScore} patient{awaitingScore === 1 ? "" : "s"} still being
              scored by the local model — rows fill in as each result lands.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
