/**
 * Module 2a — "Score": ask the local model for an ESI-style acuity assessment.
 *
 * Contract with the model (enforced three ways: JSON-Schema-constrained
 * decoding, a strict validator, and a repair retry):
 *
 *   { acuity_level: 1..5, confidence: 0..1, rationale: string,
 *     atypical_presentation_flag: boolean, atypical_reason: string }
 *
 * If the model is unreachable, too slow, or produces garbage twice, we fall
 * back to a transparent rule-based scorer. The demo must never show an empty
 * queue because a laptop couldn't load a model — but a fallback score is
 * labelled as such everywhere it appears in the UI.
 */

import {
  OLLAMA_MODEL,
  OllamaUnavailableError,
  extractJsonObject,
  ollamaChat,
  type OllamaChatMessage,
} from "./ollama";
import { newsScore } from "./urgency";
import { RISK_FACTORS } from "./types";
import type { AcuityLevel, AiScore, Patient, RiskFactor } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a triage decision-support model for an emergency department SIMULATION. You never treat anyone; you produce a structured assessment that a human nurse reviews and may override.

Assign an ESI-style acuity level from 1 to 5:
1 = requires immediate life-saving intervention
2 = high risk, should not wait, or severe pain/distress, or confused/lethargic
3 = stable but needs two or more resources (labs, imaging, IV meds)
4 = needs one resource
5 = needs no resources

Rules you must follow:
- Ground your reasoning in the SPECIFIC vitals and chief complaint you are given. Name the actual numbers that drove your decision.
- Set atypical_presentation_flag to true when a mild-sounding complaint could represent a serious, time-critical condition. Pay particular attention to: indigestion/jaw/arm/back discomfort or isolated fatigue in a diabetic, older, or female patient (acute coronary syndrome); non-specific dizziness or unilateral clumsiness (posterior stroke); "worst ever" or thunderclap headache (subarachnoid haemorrhage); back pain with neurological features (cord compression); abdominal pain with fever and tachycardia (sepsis); breathlessness after immobility or with oestrogen use (pulmonary embolism).
- Age, cardiac risk factors, and family history raise risk. Who the patient is does NOT. You are given no ethnicity, community, region, language, religion or payer information — none is recorded anywhere in this system — and you are not given the patient's name either. Do not speculate about any of it.
- risk_factors is the most important field. Pick every entry from this exact list that the presentation genuinely supports, or ["none"] if none do:
    airway_compromise  - swelling, stridor, drooling, or any threat to the airway
    neuro_red_flag     - thunderclap headache, focal deficit, new confusion, reduced consciousness
    cardiac_ischaemia  - any presentation that could be acute coronary syndrome, including atypical ones
    thromboembolic     - possible PE or DVT: immobility, long travel, oestrogen use, unilateral leg swelling
    sepsis             - infection plus physiological disturbance
    haemorrhage        - active or concealed bleeding, or anticoagulation with injury
  These drive time-criticality directly, so do not pad the list. Choose only what the case supports.
- confidence is your own certainty, 0 to 1. Use a genuinely low number when the presentation is ambiguous.
- rationale must be 1 to 2 sentences, no more.

Reply with a single JSON object and nothing else.`;

/** JSON Schema handed to Ollama's `format` parameter to constrain decoding. */
export const SCORE_SCHEMA = {
  type: "object",
  properties: {
    acuity_level: { type: "integer", minimum: 1, maximum: 5 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
    atypical_presentation_flag: { type: "boolean" },
    atypical_reason: { type: "string" },
    risk_factors: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "airway_compromise",
          "neuro_red_flag",
          "cardiac_ischaemia",
          "thromboembolic",
          "sepsis",
          "haemorrhage",
          "none",
        ],
      },
    },
  },
  required: [
    "acuity_level",
    "confidence",
    "rationale",
    "atypical_presentation_flag",
    "risk_factors",
  ],
} as const;

export function buildUserPrompt(p: Patient): string {
  const v = p.arrivalVitals;
  return [
    `Patient ${p.id} (synthetic).`,
    `Age: ${p.age}`,
    `Sex: ${p.sex === "M" ? "male" : "female"}`,
    `Chief complaint: ${p.chiefComplaint}`,
    `History and context: ${p.narrative}`,
    "Vitals on arrival:",
    `  Heart rate: ${v.hr} bpm`,
    `  Blood pressure: ${v.sbp}/${v.dbp} mmHg`,
    `  Respiratory rate: ${v.rr} /min`,
    `  SpO2: ${v.spo2}% on room air`,
    `  Temperature: ${v.temp} °C`,
    "",
    "Return the JSON assessment.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ParsedScore {
  acuity_level: AcuityLevel;
  confidence: number;
  rationale: string;
  atypical_presentation_flag: boolean;
  atypical_reason?: string;
  risk_factors: RiskFactor[];
}

export function validateScore(raw: unknown): ParsedScore {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("model output was not a JSON object");
  }
  const o = raw as Record<string, unknown>;

  // Small models sometimes emit "3" or "ESI 3" instead of 3.
  const levelRaw = o.acuity_level ?? o.acuity ?? o.esi;
  const levelNum =
    typeof levelRaw === "number"
      ? levelRaw
      : Number(String(levelRaw ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(levelNum) || levelNum < 1 || levelNum > 5) {
    throw new Error(`acuity_level out of range: ${JSON.stringify(levelRaw)}`);
  }

  let confidence =
    typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  // Some models answer 85 meaning 85%.
  if (confidence > 1 && confidence <= 100) confidence /= 100;
  confidence = Math.min(1, Math.max(0, confidence));

  const rationale = String(o.rationale ?? o.reason ?? "").trim();
  if (!rationale) throw new Error("rationale was empty");

  const flagRaw = o.atypical_presentation_flag ?? o.atypical ?? false;
  const atypical =
    typeof flagRaw === "boolean" ? flagRaw : /^(true|yes|1)$/i.test(String(flagRaw));

  const atypicalReason = String(o.atypical_reason ?? "").trim();

  // Anything outside the closed vocabulary is dropped rather than trusted —
  // a hallucinated risk name must never reach the urgency weights.
  const rawFactors = Array.isArray(o.risk_factors) ? o.risk_factors : [];
  const riskFactors = [
    ...new Set(
      rawFactors
        .map((f) => String(f).trim().toLowerCase().replace(/[\s-]+/g, "_"))
        .filter((f): f is RiskFactor =>
          (RISK_FACTORS as string[]).includes(f),
        ),
    ),
  ].filter((f) => f !== "none");

  return {
    acuity_level: Math.round(levelNum) as AcuityLevel,
    confidence: Math.round(confidence * 100) / 100,
    rationale: rationale.slice(0, 400),
    atypical_presentation_flag: atypical,
    atypical_reason: atypicalReason ? atypicalReason.slice(0, 300) : undefined,
    risk_factors: riskFactors.length ? riskFactors : ["none"],
  };
}

// ---------------------------------------------------------------------------
// Rule-based fallback
// ---------------------------------------------------------------------------

const ATYPICAL_PATTERNS: { re: RegExp; why: string; factor: RiskFactor }[] = [
  { re: /indigestion|heartburn|jaw|reflux/i, why: "possible atypical acute coronary syndrome", factor: "cardiac_ischaemia" },
  { re: /worst.*headache|thunderclap/i, why: "possible subarachnoid haemorrhage", factor: "neuro_red_flag" },
  { re: /dizz|light-?headed|clumsy/i, why: "possible posterior circulation stroke", factor: "neuro_red_flag" },
  { re: /confus|less responsive|lethargic/i, why: "possible sepsis or intracranial event", factor: "sepsis" },
  { re: /shortness of breath|breathless|dyspnoea/i, why: "possible PE or cardiac failure", factor: "thromboembolic" },
  { re: /swelling.*(lip|tongue)|stridor|drooling/i, why: "threatened airway", factor: "airway_compromise" },
];

/**
 * Deterministic, fully explainable scorer used when the LLM is unavailable.
 * NEWS drives the level; a keyword scan drives the atypical flag. It is
 * intentionally crude — its job is to keep the demo alive and to make it
 * obvious in the UI that no model was involved.
 */
export function heuristicScore(p: Patient): ParsedScore {
  const news = newsScore(p.arrivalVitals);
  const text = `${p.chiefComplaint} ${p.narrative}`;

  let level: AcuityLevel;
  if (news >= 9) level = 1;
  else if (news >= 6) level = 2;
  else if (news >= 3) level = 3;
  else if (news >= 1) level = 4;
  else level = 5;

  const match = ATYPICAL_PATTERNS.find((pat) => pat.re.test(text));
  const riskFactors =
    /diabet|heart attack|smok|contracept|apixaban|sickle/i.test(text) || p.age >= 65;

  const atypical = Boolean(match) && riskFactors;
  if (atypical && level > 3) level = 3;

  return {
    acuity_level: level,
    confidence: 0.35,
    rationale: `Rule-based fallback (no LLM available): NEWS ${news} from HR ${p.arrivalVitals.hr}, BP ${p.arrivalVitals.sbp}/${p.arrivalVitals.dbp}, RR ${p.arrivalVitals.rr}, SpO2 ${p.arrivalVitals.spo2}%, temp ${p.arrivalVitals.temp}°C maps to ESI ${level}.`,
    atypical_presentation_flag: atypical,
    atypical_reason: atypical ? `Keyword match — ${match!.why}.` : undefined,
    // Keyword-derived, and deliberately weaker than the model's reading: the
    // fallback can only see words, not the clinical picture behind them.
    risk_factors: atypical && match ? [match.factor] : ["none"],
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ScoreAttemptLog {
  attempt: number;
  request: unknown;
  responseText?: string;
  error?: string;
  durationMs: number;
}

export interface ScoreResult {
  score: AiScore;
  attempts: ScoreAttemptLog[];
}

/**
 * Try the local model, then a repair retry that shows the model its own bad
 * output, then the rule-based fallback. Returns both the score and a full
 * request/response log for the audit trail.
 */
export async function scorePatient(p: Patient): Promise<ScoreResult> {
  const attempts: ScoreAttemptLog[] = [];
  const userPrompt = buildUserPrompt(p);
  const messages: OllamaChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const started = Date.now();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const request = {
      model: OLLAMA_MODEL,
      messages,
      stream: false as const,
      // JSON-Schema-constrained decoding (Ollama >= 0.5). Older builds ignore
      // the schema and treat any truthy `format` as plain JSON mode.
      format: SCORE_SCHEMA,
      options: { temperature: 0.2, top_p: 0.9, num_predict: 400 },
      keep_alive: "10m",
    };
    const attemptStarted = Date.now();

    try {
      const res = await ollamaChat(request);
      const text = res.message?.content ?? "";
      const jsonText = extractJsonObject(text);
      if (!jsonText) throw new Error("no JSON object found in model output");

      const parsed = validateScore(JSON.parse(jsonText));
      attempts.push({
        attempt,
        request,
        responseText: text,
        durationMs: Date.now() - attemptStarted,
      });

      return {
        score: {
          ...parsed,
          source: "llm",
          model: res.model || OLLAMA_MODEL,
          latencyMs: Date.now() - started,
          scoredAt: new Date().toISOString(),
        },
        attempts,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({
        attempt,
        request,
        error: message,
        durationMs: Date.now() - attemptStarted,
      });

      // A dead daemon will not be fixed by retrying with a nicer prompt.
      if (err instanceof OllamaUnavailableError) break;

      if (attempt === 1) {
        messages.push({
          role: "user",
          content: `That response could not be parsed (${message}). Reply with ONLY a JSON object with exactly these keys: acuity_level (integer 1-5), confidence (number 0-1), rationale (string, 1-2 sentences), atypical_presentation_flag (boolean), atypical_reason (string). No prose, no code fences.`,
        });
      }
    }
  }

  const fallback = heuristicScore(p);
  return {
    score: {
      ...fallback,
      source: "heuristic-fallback",
      model: "rule-based",
      latencyMs: Date.now() - started,
      scoredAt: new Date().toISOString(),
    },
    attempts,
  };
}
