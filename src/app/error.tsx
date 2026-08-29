"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Without this, a single render throw blanks the entire wallboard with no
 * indication of what happened — the worst possible failure mode for a screen
 * people are meant to glance at under pressure. The department is still there;
 * only the view broke, so say so and offer the one-click way back.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[adaptive-triage] dashboard render failed:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-md rounded-card p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-tint-red">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-st-critical"
            strokeWidth={1.8}
            strokeLinecap="round"
          >
            <path d="M12 8v5M12 16.5v.5M12 3 2 20h20L12 3Z" />
          </svg>
        </div>
        <h1 className="display-tight text-headline font-semibold text-label">
          The dashboard failed to render
        </h1>
        <p className="mt-2 text-footnote text-label-2">
          The simulated department is unaffected — no patient state was lost.
          Only this view stopped. Reloading rebuilds it from the server.
        </p>
        {error.message && (
          <pre className="mt-4 max-h-32 overflow-auto rounded-ctl bg-fill px-3 py-2 text-left font-mono text-caption2 text-label-2">
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-capsule bg-sys-blue px-4 py-2 text-subhead font-medium text-white transition-all duration-200 hover:brightness-110"
        >
          Reload the dashboard
        </button>
      </div>
    </main>
  );
}
