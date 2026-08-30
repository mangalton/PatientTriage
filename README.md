# Adaptive Triage

**A prototype for continuously re-scored emergency department triage.**

Runs entirely on your own machine against a local open-source LLM served by
[Ollama](https://ollama.com). No API key, no cloud service, no network egress.

---

## The problem

An emergency department assigns each arriving patient an acuity score — typically
ESI 1–5 — at intake. That score then decides their place in the queue for the next
two to four hours of waiting.

The score is assigned **once** and never recomputed. Two failure modes follow:

1. **Silent deterioration.** A patient triaged correctly as low-acuity at 09:40 can
   be a different patient at 11:10. An evolving MI, a developing sepsis, a slowly
   falling blood pressure — none of it changes their queue position, because their
   queue position was fixed by a number written down when they walked in. The
   system has no mechanism for noticing that the number went stale.

2. **Unwarranted variation in prioritisation.** Human triage decisions are not
   evenly distributed — under-treatment of sickle cell pain crises and
   disparities in analgesia decisions are among the better-documented findings in
   emergency medicine. Because each decision is made individually and never
   aggregated, the pattern is invisible from inside the department. Nobody sees
   the distribution; everybody only ever sees one patient.

   The usual way to surface this is to record demographics and group by them.
   **This prototype deliberately does not.** It records nothing about who a
   patient is, and audits the override layer instead on how the patient arrived
   and on whether an override contradicts that patient's own vital signs. See
   [Equity considerations](#equity-considerations) for the argument and its
   costs.

This prototype demonstrates a layered decision-support system that addresses both:
acuity is scored by a model with an explicit rationale, urgency is **recomputed
continuously** as a function of wait time and drifting physiology, every nurse
override is logged, and the aggregate of those overrides is audited for group-level
gaps.

---

## How this maps to the brief

| Requirement | Where |
|---|---|
| Triage scoring on 15–20 simulated records | 21 patients, 33 under surge — [`src/lib/seed.ts`](src/lib/seed.ts) |
| At least one ambiguous presentation | P-017 Mehra (indigestion → MI), P-021 Nambiar ("off legs") |
| At least one paediatric / geriatric case | 2 paediatric (3y, 7y), 4 geriatric (68–82y) |
| At least one zero-history patient | 11 of 21 have no record on file (~52%, per the brief's "roughly half") |
| Behaviour under a 3× surge | **Simulate 3× surge** button — 12 arrivals in ~11 simulated minutes |
| Uncertainty surfaced explicitly | Confidence on every score, plus the precautionary uplift it drives |
| A clinician override, and what is logged | Override flow in the patient drawer; full audit trail tab |
| Bias toward escalation under uncertainty | [Safety-first design](#safety-first-design-the-precautionary-uplift) — one-directional by construction |
| Age-specific vital thresholds | [`src/lib/ews.ts`](src/lib/ews.ts) — six age bands, not one adult chart |
| Stated regulatory jurisdiction | [Regulatory position](#regulatory-position-and-data-protection) — India DPDP Act 2023 |

### Solutioning areas

| Area | Where |
|---|---|
| Data strategy under inconsistent completeness | [Module 1](#module-1--synthetic-patient-generator-srclibseedts) + the data-completeness score driving the uplift |
| Decision model + representing uncertainty | Hybrid: LLM at intake, deterministic arithmetic continuously — [Module 2a/2b](#module-2a--score-srclibscorerts). Uncertainty is a first-class term, not a display field |
| Workflow design, surge vs quiet | [Behaviour under surge](#behaviour-under-surge) |
| Safety-first / fail-safe defaults | [Safety-first design](#safety-first-design-the-precautionary-uplift) |
| Adoption & change management | [Adoption and change management](#adoption-and-change-management) |
| Patient data protection | [Regulatory position](#regulatory-position-and-data-protection) |
| Scalability across hospital size, specialty, maturity | [Flexing across hospitals](#flexing-across-hospitals) + [Scalability](#scalability) |
| Integration with existing systems | [Integration](#integration-with-existing-systems) — **staff rosters are a stated gap** |

### Real-world complexities

| Complexity | Addressed by |
|---|---|
| Ambiguous / under-reported symptoms | Atypical-presentation flag + named risk factors read from the narrative |
| Age-varying vital thresholds | [`ews.ts`](src/lib/ews.ts) — six charts. **This was the largest gap in the first version** |
| Variable data availability at intake | `PriorRecord` on ~half the cohort; completeness score; unobtainable vitals |
| Explainable in seconds, under load | Full term-by-term decomposition in the drawer; severity rail readable peripherally |
| Asymmetric cost of under- vs over-triage | Precautionary uplift, one-directional by construction |
| Hospitals differ in scale and specialty | [Flexing across hospitals](#flexing-across-hospitals) |
| Accountability, override, audit trail | Override flow + full audit tab + [regulatory mapping](#regulatory-position-and-data-protection) |
| Integration is rarely simple | Three deployment tiers; narrow seams |

---

## Solution architecture

```
  Browser (one page, polls 1 Hz)
      │
      │  GET  /api/state          full derived snapshot
      │  POST /api/clock          simulated-time control
      │  POST /api/override       nurse override + reason
      │  POST /api/surge          admit the 3× cohort
      │  POST /api/score /reset
      ▼
  Next.js API routes  ── server-only, nothing clinical runs in the browser
      │
      ├── store.ts      in-memory facts: arrivals, model outputs, overrides
      │                 derives every time-dependent value on read
      │
      ├── scorer.ts ──► Ollama on 127.0.0.1:11434   ONE call per patient
      │                 at intake, never per refresh
      │                 └── falls back to a rule-based scorer if unreachable
      │
      ├── ews.ts        age-stratified early-warning score  (deterministic)
      ├── urgency.ts    time-decay + precautionary uplift    (deterministic)
      ├── equity.ts     override audit + FDR correction      (deterministic)
      └── analysis.ts   ablation + sensitivity self-evaluation
```

**The load-bearing decision is where the model sits.** The LLM is called **once per
patient, at intake**. Everything that runs continuously — re-scoring, ranking,
early-warning, re-assessment triggers — is deterministic arithmetic over five
vitals. Expensive inference is in the rare path; the hot path is a few
floating-point operations per patient per tick. That is what makes the design
scale to a 500-visit-a-day department, and it is also what makes it auditable:
the number that moves someone up the queue can always be decomposed and shown to
the nurse it is arguing with.

**Separation of facts from derivations.** The store holds only what happened —
who arrived, what the model said, what a nurse did. Current vitals, early-warning
score, urgency, rank, and re-assessment status are all recomputed on read at the
current simulated minute. Swapping the in-memory store for Postgres therefore
means persisting the facts only; the derivation layer moves unchanged.

---

## Dependencies

**Runtime prerequisites**

| | Version | Why |
|---|---|---|
| Node.js | ≥ 18.17 | Next.js 15 requirement |
| Ollama | ≥ 0.5 | Local inference. 0.5+ needed for JSON-Schema-constrained decoding |
| A pulled model | `llama3.1` (~4.7 GB) | Any instruction-following local model works |

**Application dependencies** — four, deliberately

| Package | Version | Why this one |
|---|---|---|
| `next` | 15.1.6 | App Router gives frontend and server-only API routes in one deployable unit |
| `react` / `react-dom` | 19.0.0 | Required by Next 15 |
| `recharts` | 2.15.1 | Charts. Composable SVG, no canvas, works server-rendered |
| `tailwindcss` | 3.4.17 | Styling. Kept as a design-token system, not ad-hoc classes |

**No HTTP client, no ORM, no state library, no component kit.** Ollama is reached
with `fetch`; state is a module-level object; the design system is ~400 lines in
`ui.tsx`. **There is no `@anthropic-ai/sdk`, no `openai`, and no cloud SDK of any
kind** — the only network call the application makes is to `127.0.0.1:11434`.

**Dev dependencies:** `typescript`, `vitest`, `@types/*`, `postcss`, `autoprefixer`.


---

## Quick start

**Prerequisites:** Node.js 18.17+ and [Ollama](https://ollama.com/download).

```bash
# 1. One-time: get the model (≈4.7 GB) and make sure the daemon is up.
ollama pull llama3.1
ollama serve          # skip if Ollama is already running as a service

# 2. Install and run.
npm install
npm run dev
```

Open **http://localhost:3000**. No `.env` file is required.

The dashboard is usable immediately; acuity scores stream in over the following
40–110 seconds as the local model works through the 21-patient cohort. Watch the
progress chip in the header.

**If Ollama is not running**, the app still works. It degrades to a transparent
rule-based scorer (NEWS thresholds plus a keyword scan), labels every such score
`no-LLM` in the queue and `rule-based fallback` in the patient drawer, and logs a
`llm_fallback` event for each one. The demo never dies on stage because a laptop
couldn't load a model.

**To use a different model**, set `OLLAMA_MODEL` to any tag you have pulled — see
[`.env.example`](.env.example) for suggestions including stronger general models
and medical-tuned open models like BioMistral. Nothing in the code is
Llama-specific; the only requirement is that the model can follow a JSON schema.

---
## How AI is used, module by module

### Module 1 — Synthetic patient generator ([`src/lib/seed.ts`](src/lib/seed.ts))

No AI. **21 hand-authored synthetic cases** (33 under surge): age, sex, arrival
route, chief complaint, narrative history, five vitals, an arrival time, and —
for roughly half — a prior hospital record with conditions, medications,
allergies and sometimes a care plan. The other half are first presentations with
nothing on file, which is the split the brief assumes and which the precautionary
uplift is built to handle.

The cohort deliberately spans six age bands, because a single adult chart across
all of them is a named safety risk — see
[Age-stratified thresholds](#age-stratified-thresholds). Several are
"textbook" cases where a mild-sounding complaint masks a time-critical condition —
atypical ACS presenting as indigestion, PE presenting as anxiety, sepsis presenting
as gastritis, SAH presenting as migraine.

Each patient also carries **vital dynamics**: how their observations behave over
the wait. Deliberately not a clean linear ramp, because a monotonic ramp makes
deterioration trivially detectable and the demo self-fulfilling — NEWS on a
straight line will always cross a threshold eventually. Instead:

- **Noise** on every patient, so NEWS wobbles the way real observations wobble.
- **Inflections** — one patient improves after fluids, one compensates and then
  decompensates. Deterioration is not the only story the data tells.
- **Staleness** — one patient stops being re-measured entirely. His observations
  freeze, the UI marks how old they are, and the physiology term cannot rise no
  matter what is happening to him. This is the failure mode continuous
  re-scoring cannot engineer its way out of, and it is on screen rather than
  hidden.

Still deterministic: the same simulated minute always produces the same numbers,
so the demo is exactly reproducible.

### Module 2a — Score ([`src/lib/scorer.ts`](src/lib/scorer.ts))

**This is the LLM call.** One server-side request per patient to Ollama's
`/api/chat`, returning:

```json
{
  "acuity_level": 3,
  "confidence": 0.72,
  "rationale": "Diabetic 58-year-old with jaw and elbow radiation...",
  "atypical_presentation_flag": true,
  "atypical_reason": "Possible atypical acute coronary syndrome."
}
```

The prompt requires the model to ground its reasoning in the specific numbers it
was given, to state its own confidence honestly, and to flag atypical
presentations of serious conditions — with a named list of the presentations that
matter most (ACS, posterior stroke, SAH, cord compression, sepsis, PE). It states
explicitly that age and cardiac risk factors raise risk but identity does not.
The point is close to moot here, because there is no identity data in the system
to leak — and the patient's *name* is withheld from the prompt too, since a
surname carries community and regional signal all on its own.

Structured output is enforced **three ways**, because an 8B model on consumer
hardware will find every way to disappoint you:

1. **JSON-Schema-constrained decoding** via Ollama's `format` parameter, which
   constrains the sampler itself on Ollama ≥ 0.5.
2. **A tolerant parser and validator.** A balanced-brace extractor strips code
   fences and conversational preamble; the validator accepts `"3"` and `"ESI 3"`
   for `3`, and `85` for a confidence of `0.85`.
3. **A repair retry** that shows the model its own unparseable output and the
   exact key list, then **a rule-based fallback** if that also fails.

Every request, response, parse failure, retry, and fallback is written to the
audit trail with full payloads — expandable in the **Audit trail** tab.

### Module 2b — Monitor ([`src/lib/urgency.ts`](src/lib/urgency.ts))

No AI — deliberately. The continuous re-scoring is a **transparent formula**, not
a second model, because a number that changes a queue position needs to be
inspectable by the nurse it is arguing with.

```
urgency(t) = base(acuity)
           + escalationRate(acuity, atypical) × waitMinutes    [capped]
           + atypicalBoost
           + riskFactorLift          ← named clinical risks, applied as a floor
           + ambientBoost
           + 4 × NEWS(vitals(t))
```

| Term | Value | Rationale |
|---|---|---|
| `base(acuity)` | `12 × (6 − acuity)` → ESI 1 = 60 … ESI 5 = 12 | The intake score still matters; it is just no longer allowed to dominate. |
| `escalationRate` | ESI 1: 0.34 … ESI 5: 0.06 points/min | Sicker patients decay faster. |
| ×2.0 multiplier | when `atypical_presentation_flag` is set | An atypical presentation is where the intake number is least trustworthy, so time hurts more. |
| `atypicalBoost` | +10 | A constant nudge on top of the faster clock. |
| `riskFactorLift` | lift toward a per-risk floor, capped at ~2 ESI levels | See below — this is the term that makes the model load-bearing. |
| `ambientBoost` | +6 | Ambient sensing nudges; it never decides. |
| `4 × NEWS` | 0–80 | The physiologic term, from the patient's **current** observations. |

Bands: **Watch** ≥ 55, **Escalated** ≥ 90, **Critical** ≥ 105, ceiling 200.

**Why the base term is compressed.** An earlier revision used
`base = 20 × (6 − acuity)`, which made the intake score ~70% of every patient's
total and left the whole system **0.95 rank-correlated with a purely static
ordering** — i.e. it reproduced the exact failure it exists to fix. Compressing
the step to 12 lets accumulated waiting and drifting physiology actually
overturn an intake decision. The Evidence panel reports the current figure live.

**Why risk factors are a floor, not a bonus.** They were a flat bonus first, and
the ablation immediately showed that term moving **zero rows** despite carrying
12% of all urgency points: the model attaches risks to precisely the patients it
already scored as urgent, so a flat bonus inflated everyone equally and decided
nothing. A floor breaks that collinearity and matches how a red flag actually
behaves — it does not make a resus patient more resus, it stops a patient being
left at ESI-4 with a story that could be an MI. The lift is capped at roughly two
ESI levels so one word from the model can never teleport anyone to the top.

### Module 2c — Evidence ([`src/lib/analysis.ts`](src/lib/analysis.ts))

Every constant above is invented. That is unavoidable without outcome data, and
only defensible if we say *how much each invented number actually matters* — so
the app measures it and shows the result in the **Evidence** tab rather than
burying a disclaimer in this file.

- **Versus doing nothing.** Rank correlation between the live queue and a static
  intake ordering with FIFO tie-breaking. If this reads ~1.0, the dynamic layer
  is not changing decisions and the project has not done its job.
- **Ablation.** Zero one term, re-rank, measure the displacement. A term
  contributing many points but moving no rows is inflating everyone equally and
  deciding nothing — that is a defect, and it is how the risk-factor bug above
  was found.
- **Sensitivity.** Scale each constant ±50% and re-rank. A constant the ordering
  barely responds to is defensible as arbitrary; one it responds to strongly is
  a stated risk, and is where outcome data would have to come first.

> A methodological note that cost us a wrong number once: ranking by acuity alone
> leaves large ties, and breaking them in live-queue order correlates the
> ordering with itself and inflates ρ to a meaningless ~0.99. Ties **must** be
> broken by arrival time.

### Module 3 — Override audit ([`src/lib/equity.ts`](src/lib/equity.ts))

No AI, and no demographic data. Two axes, neither of which requires profiling
anyone:

| Check | Method | What it catches |
|---|---|---|
| Mean assigned acuity by arrival route | pooled-SD z | Aggregate priority differences |
| Nurse downgrade rate by arrival route | pooled-proportion z | Bias in the **human** layer |
| Severity-matched acuity (NEWS ≥ 3) | pooled-SD z | Gaps surviving a physiology control |
| **Self-contradiction** | none — per patient | A downgrade applied to someone whose own NEWS is already abnormal |

Findings are corrected with **Benjamini–Hochberg** at q = 0.05. Two details
matter: the correction runs across *every* comparison performed, not the ones
that looked interesting — screening on |z| first and then correcting the
survivors shrinks the denominator to exactly the tests most likely to be false
positives and stops the correction doing anything. And on a single 18-patient
shift, the group-level gaps frequently *do not survive*, which is the honest
result and is shown as such.

The self-contradiction check is the one that matters, and it needs no grouping
variable and no statistical power at all: each patient is compared only against
themselves, so it fires on the **first** unsafe override instead of waiting for a
pattern to become detectable — by which point the harm has happened repeatedly.

### Module 4 — Arrival screening (stretch)

Simulated, not built. Three patients carry an `ambient` flag with a plausible
reason and a confidence — *"No verbal response to check-in kiosk prompt; slumped
posture sustained >4 min"*. It contributes a small +6 to urgency, deliberately too
small to move anyone on its own. The point is to show where such a signal would
enter the system and how much weight it should get, without pretending to have
built audio/video processing.

### Module 5 — Surge prediction (stretch) ([`src/lib/surge.ts`](src/lib/surge.ts))

A 4-hour moving average over 24 hours of synthetic hourly arrivals, projected six
hours forward, with Poisson prediction bounds (λ ± 1.96√λ). Counts are Poisson-ish
and a Poisson's variance is its mean, so the interval falls out of the point
estimate with no fitting. Charted against a mock staffed capacity line: when the
upper bound crosses it, that is the signal a charge nurse would use to pull in
cover early.

### Module 6 — Flow routing (stretch) ([`src/lib/flow.ts`](src/lib/flow.ts))

Greedy match of the live queue onto 11 mock bays (resus / acute / fast-track).
Each patient takes the **least-capable** bay still appropriate for their acuity,
so a resus bay is not consumed by an ESI-3 while an ESI-1 is still in the waiting
room.

---

## Safety-first design: the precautionary uplift

**Under-triage and over-triage do not cost the same.** Seeing a well patient
early wastes a slot; leaving a deteriorating one in the queue can kill them. A
system optimised for average accuracy will happily trade one for the other, so
this one is deliberately not.

Wherever the assistant is uncertain, it **adds** urgency. The term is
one-directional by construction — there is no path through the code that lowers
a score because information is missing — and there is a unit test that sweeps
every combination of uncertainty and asserts the contribution is never negative.

| Source of uncertainty | Effect | Reasoning |
|---|---|---|
| Model confidence ≤ 0.6 | up to **+14**, scaled by how unsure | The model is told explicitly that honest low confidence protects the patient, so it should not inflate the number |
| First presentation, nothing on file | **+8** | Absence of history is absence of information, never evidence of wellness |
| Observation could not be obtained | **+5** each | A missing vital must not score zero |
| Paediatric age band | **+10** | Children compensate and then crash — "looks stable" is least reliable in them |
| Older adult | **+6** | Atypical presentation, lower physiological reserve |

Every applied margin is itemised in the patient drawer with its reason, so a
nurse can see the system is being cautious rather than confident.

### Mandatory re-assessment on elapsed time

Independently of whether a score has drifted, a patient triggers mandatory
re-assessment once they have waited longer than their acuity level safely
permits — ESI-2 at 10 minutes, ESI-3 at 30, ESI-4 at 60, ESI-5 at 120. This is a
hard time trigger, not a score threshold, and it is what stops a stable-looking
patient being silently parked. The count is on the header and on every affected
row.

### Age-stratified thresholds

NEWS2 is validated for adults aged 16+ and explicitly not for children. Applying
one adult chart across all ages is a named safety risk, and the two age groups
fail in **opposite** directions:

| | Adult chart error | Consequence |
|---|---|---|
| Children | **Over-reads** age-normal tachycardia and tachypnoea | Alarm fatigue; staff learn to ignore paediatric warnings |
| Older adults | **Under-reads** blunted fever and relative hypotension | Genuine sepsis scores near zero |

Measured on the live cohort: a completely well 2-year-old scores **0** on the
paediatric chart and **7** on the adult chart. An 82-year-old with early sepsis
scores **3** age-appropriately and **1** on the adult chart. Both figures are
shown side by side in every non-adult patient's chart.

Blood pressure is the exception and the trap. Paediatric hypotension is a late,
near-terminal sign, so any hypotension in a child scores maximum. An early draft
of the chart scored a shocked three-year-old at one point; a unit test caught it.

---

## Behaviour under surge

Press **Simulate 3× surge** to admit 12 further arrivals inside ~11 simulated
minutes — roughly three times the normal rate — on top of the 21 already waiting.

**Nothing about the scoring changes, and that is the design choice.** A patient's
physiology is indifferent to how busy the department is, and quietly relaxing
thresholds under load is precisely how a system begins under-triaging exactly
when the consequences are worst. What surge changes is what becomes *visible*:

- arrivals in the last simulated hour roughly double
- the count of patients past their safe re-assessment window rises
- the flow-routing panel shows demand outstripping staffed bays

The surge cohort is also where two teaching cases sit: a **well 2-year-old** who
an adult chart would flag as an emergency, and an **88-year-old after a long lie**
whose observations are unremarkable on adult thresholds.

---

## Regulatory position and data protection

**Assumed jurisdiction: India — Digital Personal Data Protection Act 2023
(DPDP), alongside the ABDM health-data framework.** GDPR would impose a broadly
similar shape with a stricter automated-decision-making article; the design below
is intended to satisfy the stricter reading.

| Obligation | How the design meets it |
|---|---|
| **Purpose limitation** | Every field exists for triage. There is no ethnicity, community, region, religion, language, caste or payer column in the data model — see [Equity considerations](#equity-considerations) |
| **Data minimisation** | The model receives ID, age band, sex, complaint, history, vitals. It is **not** given the patient's name, because a surname carries community and regional signal |
| **No solely-automated decisions** | The model never assigns priority. A nurse may override at any time, one click, and the acuity in force is always the human's if one exists |
| **Auditability** | Every model request and response, every fallback, every override with its stated reason and author, and every clock change is logged with a timestamp and is inspectable in the Audit trail tab |
| **Explainability** | Every urgency score decomposes into named terms shown in the patient drawer. No score is displayed that cannot be explained |
| **Storage limitation** | Nothing is persisted. The store is in-memory and dies with the process |
| **Cross-border transfer** | Does not arise. Inference is local; the only network connection is to `127.0.0.1:11434` |

**What a production deployment would still need**, and does not have here:
role-based access control, per-clinician authentication on overrides (currently a
demo user), encryption at rest once a database exists, a defined retention and
erasure schedule, a documented consent model for secondary use, and a Data
Protection Impact Assessment. These are governance work, not code, and are out of
scope for a prototype on synthetic data.


---

## Using the dashboard

**Simulated clock.** All wait times are simulated minutes since the ED day start
(08:00), so a four-hour wait doesn't take four hours to demonstrate. The header
has `Paused / 1× / 60× / 300×` speed controls and `+15m / +1h / −30m` jumps. At
60× the queue re-sorts continuously while you talk.

**Queue.** Sorted by current urgency by default. The **Δ column** shows how far
each patient has moved since arrival — this is the direct visualisation of what a
static score cannot do. Switch the sort to *Static acuity (intake)* to show a
judge exactly what the old queue would have looked like. Flags: `atypical`,
`escalated`, `override`, `ambient`, `no-LLM`.

**Patient drawer** (click any row). Vitals with arrival-vs-now deltas and per-vital
NEWS contributions; the model's rationale and confidence; the full urgency
decomposition term by term; a projection chart with the escalation threshold and
"now" marked; the override control; and the override history with reasons.

**Tabs.** Equity audit · Surge · Flow · Audit trail.

**Reset demo** reseeds the department to the identical starting cohort.

---

## Flexing across hospitals

The brief assumes departments from ~100 to 500+ visits a day, differing in
specialty mix and technical maturity. A workflow tuned for a large urban trauma
centre must not be the only thing on offer.

**What is already configurable rather than hard-coded**

| Varies by site | Mechanism |
|---|---|
| Urgency weights | `UrgencyWeights` is an injected object, not constants — see [`src/lib/urgency.ts`](src/lib/urgency.ts). A site supplies its own |
| Which weights *need* tuning | The **Evidence** tab's sensitivity sweep tells a new site which constants the ordering actually depends on. Most come back insensitive, so a small site can adopt the defaults for those and tune only the few that matter |
| Age charts | Table-driven in [`src/lib/ews.ts`](src/lib/ews.ts). PEWS is chart-specific in real use; a site swaps the tables, not the code |
| Safe wait targets | `SAFE_WAIT_MINUTES` is a per-acuity table. ESI, ATS and CTAS set different targets |
| Severity scale | Five-level ESI here, but nothing outside `AcuityLevel` assumes five |
| Specialty mix | The risk-factor vocabulary is a closed enum. A cardiac centre or a paediatric hospital adds its own terms and weights without touching the engine |

**Technical maturity — three deployment tiers**

1. **No integration.** Runs standalone on one machine with a local model. A nurse
   types the complaint and vitals. This works today, needs no hospital IT
   project, and is the realistic entry point for a small or rural department —
   the rule-based fallback means it runs with no GPU at all.
2. **Read-only feed.** Consumes patient records and observations from the EHR;
   still writes nothing back. Overrides live in this system's own audit log.
3. **Bidirectional.** Writes acuity and re-assessment triggers back to the
   patient record and the bed-management system.

Most departments would sit at tier 1 or 2 for a long time, and the design does
not assume otherwise.

---

## Integration with existing systems

The seams are deliberately narrow — each is one small interface, not a dependency
on a whole EHR.

| System | Seam today | What production replaces it with |
|---|---|---|
| Patient records | `PriorRecord` — visits, conditions, medications, allergies, care plan | An HL7 FHIR `Patient` + `Condition` + `MedicationStatement` query. Deliberately a narrow projection: this is the entire EHR surface the assistant needs |
| Observations | `projectVitals()` simulates drift | Replace with "read the latest recorded observation". Everything downstream is unchanged — this is the single most important seam, and the one the stale-observations case exists to stress |
| Bed management | `flow.ts` takes a `Bed[]` | A live bay-status feed |
| **Staff rosters** | **Not modelled.** Capacity is a constant (`STAFFED_CAPACITY_PER_HOUR`) | **An honest gap.** Real surge response depends on who is actually on shift and what skill mix they have. A single capacity number cannot express "two doctors but no paediatric-trained nurse", which is exactly the constraint that decides whether the 3-year-old gets seen |

---

## Adoption and change management

A triage tool that fatigued staff route around is worse than no tool, because it
still absorbs attention and still carries liability. The design choices below are
aimed squarely at that risk rather than at accuracy.

**It never blocks.** The assistant is advisory. A nurse can ignore every number
on the screen and the queue still functions. Nothing waits on a model response —
patients appear immediately and scores fill in behind them.

**Overriding is one click and always available.** If disagreeing with the system
is slow or requires justification through a form, staff stop disagreeing with it
and start disagreeing with it *silently* — which destroys the audit trail. A
reason is requested, not enforced.

**It explains itself in the same glance as the number.** Every urgency score
decomposes into named terms in the patient drawer. Trust comes from
inspectability, not from accuracy claims a nurse has no way to verify at 3 a.m.
No score is ever displayed that cannot be decomposed.

**It asks for no new data entry.** Every input is something triage already
records. Any tool that adds keystrokes to a triage assessment will lose.

**Override rate is the adoption metric, and both extremes are bad.** A very high
override rate means the model is wrong and should be recalibrated. A near-zero
rate is worse — it means automation bias, staff deferring to a number they have
stopped reading. The audit panel makes both visible, and neither is treated as
success.

**The audit is aimed at the department, not the individual.** Naming individual
nurses on a wallboard would guarantee rejection and would be indefensible on
these sample sizes anyway. Findings are reported at cohort level over time.

**Phased introduction.** The honest rollout is silent-mode first: run it in
shadow for weeks, changing nothing, and show the department its own historical
numbers — its own wait-time breaches, its own override patterns — before it is
allowed to influence a queue. A tool that arrives already telling people they
were wrong does not get adopted.


---

## Scalability

The prototype is a single-process in-memory store, which is the right choice for a
hackathon and the wrong choice for a department. What would have to change, and
what would not:

**Assumed volume: 100–500+ visits per day**, per the brief. At the top of that
range a department sees roughly 20 arrivals an hour at peak.

**What already scales.** The expensive AI call happens **once per patient at
intake**, not per refresh. Continuous re-scoring is pure arithmetic over five
vitals — roughly 10 floating-point operations per patient per tick. A 60-bed ED
with 200 patients through the waiting room in a day is 200 LLM calls, which an 8B
model on one commodity GPU serves comfortably; the re-scoring for all of them
costs less than a millisecond per tick. **The design deliberately puts the
inference in the rare path and the arithmetic in the hot path.**

**What would have to change.**

- *State.* Swap the in-memory store for Postgres. The store already separates
  facts (arrivals, model outputs, overrides) from derived values (urgency, NEWS,
  rank), which are recomputed on read — so the schema is just the facts, and the
  derivation layer moves unchanged.
- *Vitals.* The linear `trajectory` is the simulation's stand-in for a real vitals
  feed. In production it becomes a monitor or EHR integration writing timestamped
  observations; `projectVitals()` is replaced by "read the latest observation" and
  every downstream module is untouched.
- *Push, not poll.* The dashboard polls at 1 Hz, which is fine for one screen and
  wrong for thirty. Server-sent events on the derived snapshot.
- *Serving.* Ollama on one machine is a demo topology. A real deployment runs vLLM
  or TGI behind a queue, batching intake scoring requests — an intake call is not
  latency-critical at the tens-of-seconds scale, so throughput batching is nearly
  free.
- *Model.* An 8B model is not the right model. The architecture is
  model-agnostic — `OLLAMA_MODEL` is the only thing that changes — so this is a
  procurement and validation question, not an engineering one.

**Local-first is a scalability property, not just a privacy one.** Because
inference runs inside the hospital, per-patient cost is amortised hardware rather
than per-token billing, and the system keeps working when the network doesn't.
An ED that cannot triage during an internet outage is not a system anyone should
deploy.

---

## Equity considerations

**What the system does.**

- The model is never given the community tag, **and never given the patient's
  name either** — see `buildUserPrompt` in [`src/lib/scorer.ts`](src/lib/scorer.ts),
  which passes only the patient ID, age, sex, complaint, history and vitals. This
  matters more than the tag: in this setting a surname is a strong signal of
  community and region, so a model that saw names would have identity smuggled in
  through the back door regardless of what the tag column says. The system prompt
  additionally instructs that identity does not raise risk while age and cardiac
  risk factors do.
- **There is no demographic data to misuse.** The data model has no ethnicity,
  community, region, religion, language, caste or payer column at all, so nothing
  of the sort can be displayed, scored, or aggregated. The audit is built instead
  on arrival route (an encounter fact) and on each patient's own physiology.
- Every override is logged with its stated reason and attributed to a named nurse.
- The audit reports on the **human layer specifically** — the downgrade-rate test
  is a test of nurse behaviour, not model behaviour.
- The severity-matched comparison controls for measured physiology, which is what
  separates a real disparity from a cohort that genuinely differed in illness.
- The panel is read-only by construction and labelled as such.

**What the system does not do, and the honest risks.**

- **Removing the tag from the prompt does not remove bias from the model.** Chief
  complaints and narrative histories carry proxies for identity — presentation
  style, phrasing, named conditions with skewed prevalence. A model trained on
  historical triage data has learned historical triage decisions, disparities
  included. The audit exists precisely because "we didn't tell it their race" is
  not a defence, and the correct response to a notable finding is investigation,
  not reassurance.
- **This cohort's disparity is authored, not discovered.** The seed data was
  constructed to contain a gap so the audit has something to find. It demonstrates
  that the method works on a known-positive; it is not evidence about anything
  real.
- **The statistics are illustrative.** Groups of 2–6 patients cannot support a
  z-test conclusion. There is no multiple-comparison correction across the 15
  tests run. On real data these would be an aggregate over months, with
  appropriate correction and confidence intervals.
- **Not recording demographics has a real cost, and it should be stated plainly.**
  Arrival route and self-contradiction catch a great deal, but they cannot detect
  a disparity that runs *along* an identity axis and nowhere else — if one group
  were consistently under-triaged and they arrived by every route in the same
  proportions as everyone else, nothing in this audit would see it. "You cannot
  fix what you refuse to measure" is a genuine principle in health equity, and
  demographic monitoring is standard practice for good reasons. The counter-
  argument this prototype acts on is that a field which exists can be misused,
  displayed, or joined to something else later, and that a system which never
  collects it cannot leak it. That is a defensible trade for a prototype. For a
  real deployment it is a governance decision, not an engineering one, and it
  should be made with the communities it affects rather than for them.
- **Auditing is not fixing.** A dashboard that surfaces a gap and changes nothing
  is a way of feeling responsible without being responsible. The finding has to
  route to someone with the authority and the obligation to act.
- **The equity module can itself do harm.** A "notable gap" attached to a named
  nurse on a wallboard, on n = 5, would be indefensible. The unit of analysis has
  to be the department over time, not the individual over a shift.

---

## Impact and limitations

**The plausible impact.** The intervention is narrow and cheap: keep looking at
people who are already waiting. It needs no new staff, no new hardware at the
bedside, and no change to how intake is performed. The failure it targets —
a patient whose condition changed after their number was written down — is a known
and recurring source of preventable harm in crowded departments.

**Limitations, stated plainly.**

- **Not validated. Not a medical device.** No prospective study, no retrospective
  validation, no regulatory clearance. The constants in the urgency formula were
  chosen to be legible in a two-minute demo, not because they are correct
  medicine.
- **The urgency formula is invented.** It is a plausible-looking weighted sum,
  not a calibrated risk model. In a real system every constant would need
  derivation from outcome data, and the whole function would need recalibration
  per department. What the app *can* honestly say is how much each invented
  constant matters — see the **Evidence** tab, which reports the ablation and a
  ±50% sensitivity sweep over the live cohort. Being arbitrary is cheap where
  the ordering is insensitive and expensive where it is not, and the panel says
  which is which.

- **The demo is a known-positive test.** The seeded overrides and the
  deteriorating patient were authored to be found. That validates the plumbing,
  not the method. The noise, inflections and stale-observation case exist to
  make the detection problem non-trivial, but a genuinely blind evaluation would
  need data nobody hand-wrote.
- **NEWS is a floor, not a ceiling.** It is a general deterioration score and is
  known to be weak for specific presentations, including the early ACS this demo
  centres on. Mehra's NEWS climbs because his trajectory was authored to make it
  climb.
- **Vitals are simulated.** Real vitals in a waiting room are sparse, noisy, and
  often absent for hours. Continuous re-scoring is only as good as the data feeding
  it, and the honest version of this system spends most of its effort on that
  problem.
- **Alert fatigue is the likeliest failure mode.** A system that escalates too
  often gets ignored, and then it is worse than nothing because it has consumed
  the attention budget. Threshold tuning is the difference between this helping
  and this harming.
- **An 8B model is not a clinical reasoner.** In testing, `llama3.1:8b` compresses
  most patients into ESI 2–3 and varies its flags between runs. The demo is
  robust to this — seeded overrides are stored as *deltas* against whatever the
  model assigns — but it is a real limitation. Note also that the model's
  contribution is measurable: the Evidence tab shows exactly how many queue
  positions the risk-factor and atypical terms are responsible for, so "the LLM
  is decorative" is a claim you can check rather than argue about.

- **Vitals in a real waiting room are sparse or absent.** This is the biggest
  barrier to deployment and it sits upstream of everything here. With no
  observation feed the time-decay term degenerates into "everyone rises at a
  rate set by their intake score", which is FIFO with weights and needs no AI at
  all. The stale-observation patient is in the seed to keep that honest.
- **Automation bias runs both ways.** A confident rationale from a model that is
  wrong is more dangerous than no rationale at all. The override flow exists to
  keep the human in charge; whether it succeeds is an empirical question about
  humans, not a property of the code.
- **Arrival route is cleaner than a demographic tag, but not clean.** It is
  recorded consistently and objectively, which is exactly why it was chosen — but
  it is also a proxy. Who arrives by ambulance is shaped by distance, cost,
  and who feels entitled to call one, so a gap found along this axis may be
  carrying socioeconomic signal it cannot name. That is a limitation of the
  finding, not a reason to discard it.

---

## Project layout

```
src/
  lib/
    types.ts       Shared domain types
    seed.ts        The 18 synthetic patients — both demo stories live here
    ews.ts         Age-stratified early warning score, six bands (no AI)
    urgency.ts     Time-decay urgency + precautionary uplift (no AI)
    analysis.ts    Ablation + sensitivity self-evaluation over the live cohort
    ollama.ts      Local LLM transport, health check, JSON extraction
    scorer.ts      Prompt, schema, validation, retry, rule-based fallback
    equity.ts      Read-only group audit and z-tests
    surge.ts       Moving-average + Poisson forecast
    flow.ts        Greedy bed matching
    clock.ts       Simulated time (anchor + rate)
    store.ts       In-memory store; derives every time-dependent value on read
    view.ts        The single payload the dashboard polls
  app/
    page.tsx       Dashboard entry
    api/
      state/       GET  — full dashboard state; starts the scoring sweep
      clock/       POST — rate / jump / goto
      override/    POST — record or revert a nurse override
      score/       POST — re-score one patient or sweep all
      surge/       POST — admit the 3x surge cohort
      reset/       POST — reseed the department
  components/      Dashboard, queue, drawer, evidence, audit, surge, flow, log
  lib/__tests__/   Unit tests for the urgency model and audit statistics
```

## Scripts

```bash
npm run dev        # dev server on :3000
npm run build      # production build
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # vitest — 51 unit tests over scoring, safety margin and audit statistics
npm run test:watch
```

Tests cover the parts where a silent error would be worst: age-band routing and
paediatric hypotension (a draft chart scored a shocked three-year-old at one
point — the test caught it), the one-directional property of the precautionary
uplift swept across every combination of uncertainty, NEWS band boundaries
vital-by-vital, urgency term decomposition and monotonicity, the wait-pressure
cap, staleness and inflection behaviour in the projection, the Benjamini–Hochberg
step-up rule, and — importantly — that `validateScore` drops hallucinated risk
factors, so nothing the model invents can ever reach an urgency weight.

## Data and privacy

See [Regulatory position and data protection](#regulatory-position-and-data-protection)
for the compliance mapping. In short:

No real patient data is used, stored, or transmitted, and none may be. All 18
patients are fabricated in [`src/lib/seed.ts`](src/lib/seed.ts) — names are
randomly assembled and correspond to no one. There is no database, no persistence
to disk, and no telemetry. All model inference is local: the only network
connection the application makes is to `127.0.0.1:11434`.
