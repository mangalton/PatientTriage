"use client";

import type { ReactNode } from "react";

import type { AcuityLevel, EscalationStatus } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------------------
   Card — a floating glass pane. Radius is generous and the material carries the
   edge, so there is no border: the rim light in `.glass` is the border.
   --------------------------------------------------------------------------- */

export function Card({
  title,
  subtitle,
  right,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding — for tables that supply their own. */
  flush?: boolean;
}) {
  return (
    <section
      className={cx(
        "glass glass-interactive overflow-hidden rounded-card",
        className,
      )}
    >
      {(title || right) && (
        <header
          className={cx(
            "flex items-start justify-between gap-4 border-b border-sep px-6 pt-5",
            children ? "pb-4" : "pb-5",
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="display-tight text-headline font-semibold text-label">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1.5 max-w-prose text-footnote text-label-2">{subtitle}</p>
            )}
          </div>
          {right && <div className="shrink-0 pt-0.5">{right}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-6"}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Pill — a capsule chip. Tinted glass, matching foreground.
   --------------------------------------------------------------------------- */

type Tone = "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "indigo";

const PILL_TONE: Record<Tone, string> = {
  gray: "bg-tint-gray text-label-2",
  red: "bg-tint-red text-sys-red",
  orange: "bg-tint-orange text-sys-orange",
  yellow: "bg-tint-yellow text-sys-yellow",
  green: "bg-tint-green text-sys-green",
  blue: "bg-tint-blue text-sys-blue",
  indigo: "bg-tint-indigo text-sys-indigo",
};

export function Pill({
  tone = "gray",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-capsule px-2.5 py-[3px] text-caption font-medium",
        "shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.5)]",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Acuity badge — a solid rounded square in the ESI colour, lifted off the glass.
   --------------------------------------------------------------------------- */

export const ACUITY_STYLE: Record<
  AcuityLevel,
  { bg: string; fg: string; label: string }
> = {
  1: { bg: "bg-esi-1", fg: "text-white", label: "Immediate" },
  2: { bg: "bg-esi-2", fg: "text-white", label: "Emergent" },
  3: { bg: "bg-esi-3", fg: "text-white", label: "Urgent" },
  4: { bg: "bg-esi-4", fg: "text-white", label: "Less urgent" },
  5: { bg: "bg-esi-5", fg: "text-white", label: "Non-urgent" },
};

export function AcuityBadge({
  level,
  overridden,
  size = "md",
}: {
  level: AcuityLevel;
  overridden?: boolean;
  size?: "sm" | "md";
}) {
  const s = ACUITY_STYLE[level];
  return (
    <span className="relative inline-flex">
      <span
        title={`ESI ${level} — ${s.label}${overridden ? " (nurse override in force)" : ""}`}
        className={cx(
          "inline-flex items-center justify-center rounded-chip font-semibold tabular-nums",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_3px_rgba(28,30,45,0.16)]",
          size === "sm" ? "h-[24px] w-[24px] text-caption" : "h-[31px] w-[31px] text-subhead",
          s.bg,
          s.fg,
        )}
      >
        {level}
      </span>
      {overridden && (
        <span
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sys-indigo shadow-[0_0_0_2px_rgba(255,255,255,0.95)]"
          title="Nurse override in force"
        />
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Escalation status
   --------------------------------------------------------------------------- */

export const STATUS_STYLE: Record<
  EscalationStatus,
  {
    dot: string;
    text: string;
    accent: string;
    /** Row wash + its hover state. Escalated rows must be findable peripherally. */
    row: string;
    /** Width of the left accent rail — thicker as severity rises. */
    rail: string;
    label: string;
    pill: "red" | "orange" | "yellow" | "green";
  }
> = {
  critical: {
    dot: "bg-st-critical",
    text: "text-st-critical",
    accent: "bg-st-critical",
    row: "bg-row-critical hover:bg-row-critical-hover",
    rail: "w-[5px]",
    label: "Critical",
    pill: "red",
  },
  escalated: {
    dot: "bg-st-escalated",
    text: "text-st-escalated",
    accent: "bg-st-escalated",
    row: "bg-row-escalated hover:bg-row-escalated-hover",
    rail: "w-[4px]",
    label: "Escalated",
    pill: "orange",
  },
  watch: {
    dot: "bg-st-watch",
    text: "text-st-watch",
    accent: "bg-st-watch",
    row: "hover:bg-fill",
    rail: "w-[2px]",
    label: "Watch",
    pill: "yellow",
  },
  stable: {
    dot: "bg-st-stable",
    text: "text-st-stable",
    accent: "",
    row: "hover:bg-fill",
    rail: "w-0",
    label: "Stable",
    pill: "green",
  },
};

/* ---------------------------------------------------------------------------
   Buttons — capsules. Filled (primary), raised glass (default), plain (ghost).
   --------------------------------------------------------------------------- */

export function Button({
  children,
  onClick,
  tone = "default",
  size = "md",
  disabled,
  active,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  active?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const tones: Record<string, string> = {
    default: "glass-raised text-label hover:brightness-[1.04] active:brightness-95",
    primary:
      "bg-sys-blue text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.5),0_1px_2px_rgba(0,90,190,0.28),0_4px_12px_rgba(0,90,190,0.22)] hover:brightness-110 active:brightness-95",
    danger:
      "bg-tint-red text-sys-red shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.5)] hover:brightness-[1.04]",
    ghost: "bg-transparent text-sys-blue hover:bg-fill",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "select-none rounded-capsule font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-35",
        size === "sm" ? "px-3.5 py-[6px] text-footnote" : "px-[18px] py-[8px] text-subhead",
        tones[tone],
        active && "!bg-sys-blue !text-white",
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   Segmented control — a capsule thumb gliding inside a recessed glass well.
   --------------------------------------------------------------------------- */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  size = "md",
  className,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      className={cx(
        "glass-well relative isolate grid rounded-capsule p-[3px]",
        disabled && "opacity-40",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="tablist"
    >
      <div
        aria-hidden
        className="glass-raised pointer-events-none absolute inset-y-[3px] left-[3px] -z-10 rounded-capsule transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
        // Only the two measured values stay inline; they depend on option count
        // and selection, so no utility class can express them.
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "z-10 select-none truncate rounded-capsule px-2.5 font-medium transition-colors duration-200",
            size === "sm" ? "py-[4px] text-caption" : "py-[5px] text-footnote",
            o.value === value ? "text-label" : "text-label-2 hover:text-label",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Meter — a capsule bar in a recessed well.
   --------------------------------------------------------------------------- */

export function Meter({
  value,
  max = 1,
  tone = "blue",
}: {
  value: number;
  max?: number;
  /** Escalation statuses map onto the severity ramp; the rest are generic. */
  tone?: EscalationStatus | "blue" | "orange" | "green";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tones: Record<string, string> = {
    critical: "bg-st-critical",
    escalated: "bg-st-escalated",
    watch: "bg-st-watch",
    stable: "bg-st-stable",
    blue: "bg-sys-blue",
    orange: "bg-sys-orange",
    green: "bg-sys-green",
  };
  return (
    <div className="glass-well h-[7px] w-full overflow-hidden rounded-capsule">
      <div
        className={cx(
          "h-full rounded-capsule transition-[width] duration-500 ease-out",
          "shadow-[inset_0_0.5px_0_rgba(255,255,255,0.5)]",
          tones[tone],
        )}
        // Width is the datum itself — the one value a utility class cannot carry.
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading and empty states
   --------------------------------------------------------------------------- */

/** A shimmering placeholder block, sized by the caller. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative block overflow-hidden rounded-capsule bg-fill2",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer",
        "after:bg-gradient-to-r after:from-transparent after:via-white/70 after:to-transparent",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        "inline-block animate-spin rounded-full border-[2.5px] border-fill2 border-t-sys-blue",
        className ?? "h-5 w-5",
      )}
    />
  );
}

/**
 * Empty state. `icon` and `hint` are optional so a one-line "nothing here" stays
 * one line, while a real dead end can explain itself and offer a way out.
 */
export function Empty({
  children,
  hint,
  icon,
}: {
  children: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-fill text-label-3">
          {icon}
        </div>
      )}
      <p className="text-subhead font-medium text-label-2">{children}</p>
      {hint && (
        <p className="mt-1.5 max-w-xs text-footnote text-label-3">{hint}</p>
      )}
    </div>
  );
}

/** Small all-caps section header, as used above grouped lists. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2.5 text-caption font-semibold uppercase tracking-[0.07em] text-label-3">
      {children}
    </h3>
  );
}

/* ---------------------------------------------------------------------------
   Chart palette.

   Recharts writes colours as SVG presentation attributes, which do not resolve
   CSS custom properties — so the palette has to reach the charts as literal
   values. These mirror the tokens in globals.css.
   --------------------------------------------------------------------------- */

export const CHART = {
  grid: "rgba(60,60,67,0.10)",
  axis: "rgba(60,60,67,0.18)",
  label: "#5c5c66",
  // Same validated hues as the ESI ramp, so a chart and a badge agree.
  blue: "#0062c4",
  red: "#b3251c",
  orange: "#a94f04",
  green: "#15794a",
  gray: "rgba(116,116,127,0.42)",
  strong: "#16181d",
  /** Used to mask the lower half of a band — matches the pane, not the page. */
  paneMask: "rgba(255,255,255,0.66)",
} as const;

/** Shared Recharts tooltip styling — a small floating glass pane. */
export const CHART_TOOLTIP = {
  background: "rgba(255,255,255,0.72)",
  backdropFilter: "saturate(190%) blur(24px)",
  WebkitBackdropFilter: "saturate(190%) blur(24px)",
  border: "none",
  borderRadius: 14,
  boxShadow:
    "inset 0 0.5px 0 0 rgba(255,255,255,0.95), inset 0 0 0 0.5px rgba(255,255,255,0.5), 0 8px 28px rgba(28,30,45,0.16)",
  fontSize: 12,
  color: "#1c1c1e",
  padding: "9px 11px",
} as const;
