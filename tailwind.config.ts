import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Light only — never emit a `dark:` variant.
  darkMode: ["selector", '[data-never-dark="true"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SF Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Ink
        label: "var(--label)",
        "label-2": "var(--label-2)",
        "label-3": "var(--label-3)",
        // Hairlines / fills on glass
        sep: "var(--sep)",
        "sep-strong": "var(--sep-strong)",
        fill: "var(--fill)",
        fill2: "var(--fill-2)",
        // ESI acuity ramp (monotonic red -> green, all AA on white text)
        "esi-1": "var(--esi-1)",
        "esi-2": "var(--esi-2)",
        "esi-3": "var(--esi-3)",
        "esi-4": "var(--esi-4)",
        "esi-5": "var(--esi-5)",
        // Escalation status
        "st-critical": "var(--st-critical)",
        "st-escalated": "var(--st-escalated)",
        "st-watch": "var(--st-watch)",
        "st-stable": "var(--st-stable)",
        // Queue row washes
        "row-critical": "var(--row-critical)",
        "row-critical-hover": "var(--row-critical-hover)",
        "row-escalated": "var(--row-escalated)",
        "row-escalated-hover": "var(--row-escalated-hover)",
        // System colours
        "sys-blue": "var(--blue)",
        "sys-red": "var(--red)",
        "sys-orange": "var(--orange)",
        "sys-yellow": "var(--yellow)",
        "sys-green": "var(--green)",
        "sys-indigo": "var(--indigo)",
        "sys-teal": "var(--teal)",
        "sys-gray": "var(--gray)",
        // Tints
        "tint-blue": "var(--blue-tint)",
        "tint-red": "var(--red-tint)",
        "tint-orange": "var(--orange-tint)",
        "tint-yellow": "var(--yellow-tint)",
        "tint-green": "var(--green-tint)",
        "tint-indigo": "var(--indigo-tint)",
        "tint-gray": "var(--gray-tint)",
      },
      borderRadius: {
        // Concentric: an inset child's radius is the parent's minus its inset.
        chip: "8px",
        ctl: "12px",
        card: "22px",
        sheet: "28px",
        capsule: "999px",
      },
      boxShadow: {
        lift: "var(--lift)",
        "lift-hover": "var(--lift-hover)",
        "lift-lg": "var(--lift-lg)",
      },
      fontSize: {
        // A notch more generous than a typical dashboard scale, with looser
        // leading. Small dense type is what makes an interface read as
        // administrative rather than considered.
        caption2: ["11px", { lineHeight: "15px" }],
        caption: ["12px", { lineHeight: "16px" }],
        footnote: ["13px", { lineHeight: "19px" }],
        subhead: ["14px", { lineHeight: "20px" }],
        body: ["15px", { lineHeight: "23px" }],
        headline: ["17px", { lineHeight: "23px" }],
        title3: ["21px", { lineHeight: "27px" }],
        title2: ["28px", { lineHeight: "34px" }],
        title1: ["36px", { lineHeight: "42px" }],
      },
      keyframes: {
        sheetIn: {
          from: { opacity: "0", transform: "translateX(18px) scale(0.985)" },
          to: { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        riseIn: {
          from: { opacity: "0", transform: "translateY(5px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        breathe: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.82)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        // Apple's presentation curve.
        sheetIn: "sheetIn .42s cubic-bezier(0.32, 0.72, 0, 1) both",
        fadeIn: "fadeIn .24s ease-out both",
        riseIn: "riseIn .3s cubic-bezier(0.32, 0.72, 0, 1) both",
        breathe: "breathe 2s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
