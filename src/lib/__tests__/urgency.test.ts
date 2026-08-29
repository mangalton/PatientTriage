import { describe, expect, it } from "vitest";

import {
  ATYPICAL_RATE_MULTIPLIER,
  BASE_PER_LEVEL,
  DEFAULT_WEIGHTS,
  ESCALATION_THRESHOLD,
  MAX_WAIT_PRESSURE,
  RISK_FACTOR_WEIGHT,
  computeUrgency,
  escalationStatus,
  findEscalationCrossing,
  newsScore,
  projectVitals,
} from "../urgency";
import type { Vitals } from "../types";

const NORMAL: Vitals = { hr: 74, sbp: 124, dbp: 78, rr: 16, spo2: 98, temp: 36.7 };

describe("newsScore", () => {
  it("scores a completely normal set at zero", () => {
    expect(newsScore(NORMAL)).toBe(0);
  });

  it("scores each vital against the published NEWS bands", () => {
    // One deranged vital at a time, so a wrong threshold cannot hide behind
    // another vital's contribution.
    expect(newsScore({ ...NORMAL, rr: 8 })).toBe(3);
    expect(newsScore({ ...NORMAL, rr: 22 })).toBe(2);
    expect(newsScore({ ...NORMAL, spo2: 91 })).toBe(3);
    expect(newsScore({ ...NORMAL, spo2: 94 })).toBe(1);
    expect(newsScore({ ...NORMAL, sbp: 88 })).toBe(3);
    expect(newsScore({ ...NORMAL, sbp: 105 })).toBe(1);
    expect(newsScore({ ...NORMAL, hr: 135 })).toBe(3);
    expect(newsScore({ ...NORMAL, hr: 95 })).toBe(1);
    expect(newsScore({ ...NORMAL, temp: 34.5 })).toBe(3);
    expect(newsScore({ ...NORMAL, temp: 39.5 })).toBe(2);
  });

  it("is monotonic as a single vital worsens", () => {
    const scores = [90, 100, 115, 125, 140].map((hr) =>
      newsScore({ ...NORMAL, hr }),
    );
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

describe("projectVitals", () => {
  it("is deterministic — the same minute always gives the same numbers", () => {
    const traj = { hr: 0.3, noise: { hr: 5 } };
    const a = projectVitals(NORMAL, traj, 60, "P-1").vitals;
    const b = projectVitals(NORMAL, traj, 60, "P-1").vitals;
    expect(a).toEqual(b);
  });

  it("gives different jitter to different patients", () => {
    const traj = { noise: { hr: 8 } };
    const a = projectVitals(NORMAL, traj, 60, "P-1").vitals.hr;
    const b = projectVitals(NORMAL, traj, 60, "P-2").vitals.hr;
    expect(a).not.toBe(b);
  });

  it("applies linear drift", () => {
    const { vitals } = projectVitals(NORMAL, { hr: 0.5 }, 40);
    expect(vitals.hr).toBe(94); // 74 + 0.5*40
  });

  it("changes direction at an inflection point", () => {
    const traj = { hr: 0.5, inflectionMinutes: 40, after: { hr: -0.5 } };
    expect(projectVitals(NORMAL, traj, 40).vitals.hr).toBe(94);
    // 20 minutes past the inflection it should be back down by 10.
    expect(projectVitals(NORMAL, traj, 60).vitals.hr).toBe(84);
  });

  it("freezes observations and ages them once measurement stops", () => {
    const traj = { hr: 0.5, staleAfterMinutes: 30 };
    const at30 = projectVitals(NORMAL, traj, 30);
    const at120 = projectVitals(NORMAL, traj, 120);
    expect(at30.ageMinutes).toBe(0);
    // Frozen at the last measured value, and now 90 minutes old.
    expect(at120.vitals.hr).toBe(at30.vitals.hr);
    expect(at120.ageMinutes).toBe(90);
  });

  it("clamps to physiologically possible bounds", () => {
    const { vitals } = projectVitals(NORMAL, { spo2: -5 }, 600);
    expect(vitals.spo2).toBeGreaterThanOrEqual(70);
  });
});

describe("computeUrgency", () => {
  const base = {
    acuity: 3 as const,
    waitMinutes: 0,
    atypical: false,
    ambient: false,
    vitals: NORMAL,
  };

  it("at arrival with normal vitals is exactly the base for the level", () => {
    expect(computeUrgency(base).total).toBe(BASE_PER_LEVEL[3]);
  });

  it("decomposes into terms that sum to the total", () => {
    const b = computeUrgency({
      ...base,
      waitMinutes: 90,
      atypical: true,
      ambient: true,
      riskFactors: ["cardiac_ischaemia"],
      vitals: { ...NORMAL, hr: 115, spo2: 93 },
    });
    const sum =
      b.base +
      b.waitPressure +
      b.atypicalBoost +
      b.riskFactorBoost +
      b.ambientBoost +
      b.physiologyPressure;
    expect(b.total).toBeCloseTo(Math.round(sum * 10) / 10, 5);
  });

  it("is monotonically non-decreasing in wait time", () => {
    let prev = -Infinity;
    for (const waitMinutes of [0, 30, 60, 120, 240, 480]) {
      const u = computeUrgency({ ...base, waitMinutes }).total;
      expect(u).toBeGreaterThanOrEqual(prev);
      prev = u;
    }
  });

  it("caps wait pressure so time alone cannot swamp physiology", () => {
    const b = computeUrgency({ ...base, waitMinutes: 100_000 });
    expect(b.waitPressure).toBeLessThanOrEqual(MAX_WAIT_PRESSURE);
  });

  it("makes an atypical presentation escalate faster than a typical one", () => {
    const typical = computeUrgency({ ...base, waitMinutes: 120 });
    const atypical = computeUrgency({ ...base, waitMinutes: 120, atypical: true });
    expect(atypical.escalationRatePerMin).toBeCloseTo(
      typical.escalationRatePerMin * ATYPICAL_RATE_MULTIPLIER,
      5,
    );
    expect(atypical.total).toBeGreaterThan(typical.total);
  });

  it("counts only the single highest risk factor, never the sum", () => {
    const many = computeUrgency({
      ...base,
      riskFactors: ["sepsis", "cardiac_ischaemia", "airway_compromise"],
    });
    // Otherwise a verbose model could inflate a patient by listing everything.
    expect(many.riskFactorBoost).toBe(RISK_FACTOR_WEIGHT.airway_compromise);
  });

  it("ignores the sentinel 'none' risk factor", () => {
    expect(computeUrgency({ ...base, riskFactors: ["none"] }).riskFactorBoost).toBe(0);
  });

  it("respects injected weights, which is what the sensitivity sweep relies on", () => {
    const halved = {
      ...DEFAULT_WEIGHTS,
      physiologyWeight: DEFAULT_WEIGHTS.physiologyWeight / 2,
    };
    const sick = { ...base, vitals: { ...NORMAL, hr: 130, spo2: 92, rr: 24 } };
    expect(computeUrgency(sick, halved).physiologyPressure).toBeCloseTo(
      computeUrgency(sick).physiologyPressure / 2,
      5,
    );
  });

  it("never exceeds the ceiling", () => {
    const b = computeUrgency({
      acuity: 1,
      waitMinutes: 100_000,
      atypical: true,
      ambient: true,
      riskFactors: ["airway_compromise"],
      vitals: { hr: 190, sbp: 60, dbp: 40, rr: 40, spo2: 70, temp: 34 },
    });
    expect(b.total).toBeLessThanOrEqual(DEFAULT_WEIGHTS.urgencyMax);
  });
});

describe("escalationStatus", () => {
  it("bands are ordered and contiguous", () => {
    expect(escalationStatus(0)).toBe("stable");
    expect(escalationStatus(ESCALATION_THRESHOLD)).toBe("escalated");
    expect(escalationStatus(ESCALATION_THRESHOLD - 0.1)).not.toBe("escalated");
    expect(escalationStatus(999)).toBe("critical");
  });
});

describe("findEscalationCrossing", () => {
  it("returns null for a patient who never crosses", () => {
    const crossing = findEscalationCrossing(NORMAL, {}, 5, false, false, []);
    expect(crossing).toBeNull();
  });

  it("finds the first minute a deteriorating patient crosses", () => {
    const traj = { hr: 0.3, sbp: -0.32, rr: 0.045, spo2: -0.022 };
    const crossing = findEscalationCrossing(NORMAL, traj, 4, true, false, []);
    expect(crossing).not.toBeNull();
    // And the urgency at that minute really is at or above the threshold.
    const u = computeUrgency({
      acuity: 4,
      waitMinutes: crossing!,
      atypical: true,
      ambient: false,
      vitals: projectVitals(NORMAL, traj, crossing!).vitals,
    }).total;
    expect(u).toBeGreaterThanOrEqual(ESCALATION_THRESHOLD);
  });

  it("is memoised — repeated calls return an identical answer", () => {
    const traj = { hr: 0.3, sbp: -0.3 };
    const a = findEscalationCrossing(NORMAL, traj, 3, false, false, []);
    const b = findEscalationCrossing(NORMAL, traj, 3, false, false, []);
    expect(a).toBe(b);
  });
});
