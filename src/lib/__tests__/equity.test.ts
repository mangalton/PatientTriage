import { describe, expect, it } from "vitest";

import { benjaminiHochberg, pFromZ } from "../equity";
import { validateScore } from "../scorer";

describe("pFromZ", () => {
  it("matches known two-sided normal p-values", () => {
    expect(pFromZ(0)).toBeCloseTo(1, 3);
    expect(pFromZ(1.96)).toBeCloseTo(0.05, 3);
    expect(pFromZ(2.576)).toBeCloseTo(0.01, 3);
    expect(pFromZ(3.29)).toBeCloseTo(0.001, 3);
  });

  it("is symmetric about zero", () => {
    expect(pFromZ(2.1)).toBeCloseTo(pFromZ(-2.1), 10);
  });
});

describe("benjaminiHochberg", () => {
  it("rejects nothing when every p-value is large", () => {
    expect(benjaminiHochberg([0.4, 0.6, 0.8, 0.9])).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("keeps a clearly significant result", () => {
    const keep = benjaminiHochberg([0.0001, 0.4, 0.6, 0.8]);
    expect(keep[0]).toBe(true);
    expect(keep.slice(1)).toEqual([false, false, false]);
  });

  it("is stricter than an uncorrected 0.05 threshold", () => {
    // Fifteen tests, one marginal hit — exactly the "one significant result per
    // shift by chance" case the correction exists to suppress.
    const ps = [0.04, ...Array.from({ length: 14 }, () => 0.7)];
    const raw = ps.filter((p) => p < 0.05).length;
    const corrected = benjaminiHochberg(ps).filter(Boolean).length;
    expect(raw).toBe(1);
    expect(corrected).toBe(0);
  });

  it("uses the step-up rule, so a lower p-value rides in on a higher one", () => {
    // Both should survive: the largest k satisfying p(k) <= k/n*q is index 1.
    const keep = benjaminiHochberg([0.001, 0.02, 0.9, 0.9], 0.05);
    expect(keep[0]).toBe(true);
    expect(keep[1]).toBe(true);
  });
});

describe("validateScore — the boundary between the model and the urgency weights", () => {
  const good = {
    acuity_level: 3,
    confidence: 0.7,
    rationale: "Tachycardic and febrile.",
    atypical_presentation_flag: false,
    risk_factors: ["sepsis"],
  };

  it("accepts a well-formed response", () => {
    expect(validateScore(good).acuity_level).toBe(3);
    expect(validateScore(good).risk_factors).toEqual(["sepsis"]);
  });

  it("coerces the shapes small local models actually emit", () => {
    expect(validateScore({ ...good, acuity_level: "ESI 2" }).acuity_level).toBe(2);
    expect(validateScore({ ...good, confidence: 85 }).confidence).toBe(0.85);
    expect(
      validateScore({ ...good, atypical_presentation_flag: "yes" })
        .atypical_presentation_flag,
    ).toBe(true);
  });

  it("drops hallucinated risk factors rather than trusting them", () => {
    const out = validateScore({
      ...good,
      risk_factors: ["sepsis", "alien_abduction", "MASSIVE_BLEED"],
    });
    // Only the known term survives; nothing unknown can reach a weight.
    expect(out.risk_factors).toEqual(["sepsis"]);
  });

  it("normalises spacing and case in risk factors", () => {
    expect(
      validateScore({ ...good, risk_factors: ["Airway Compromise"] }).risk_factors,
    ).toEqual(["airway_compromise"]);
  });

  it("falls back to the 'none' sentinel when nothing valid remains", () => {
    expect(validateScore({ ...good, risk_factors: ["nonsense"] }).risk_factors).toEqual([
      "none",
    ]);
    expect(validateScore({ ...good, risk_factors: [] }).risk_factors).toEqual(["none"]);
  });

  it("de-duplicates repeated factors", () => {
    expect(
      validateScore({ ...good, risk_factors: ["sepsis", "sepsis"] }).risk_factors,
    ).toEqual(["sepsis"]);
  });

  it("rejects an out-of-range acuity rather than clamping it silently", () => {
    expect(() => validateScore({ ...good, acuity_level: 9 })).toThrow();
    expect(() => validateScore({ ...good, acuity_level: 0 })).toThrow();
  });

  it("rejects an empty rationale", () => {
    expect(() => validateScore({ ...good, rationale: "   " })).toThrow();
  });

  it("rejects non-objects", () => {
    expect(() => validateScore(null)).toThrow();
    expect(() => validateScore("ESI 3")).toThrow();
  });
});
