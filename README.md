# Adaptive Triage

**A prototype for continuously re-scored emergency department triage.**

> ⚠️ **Prototype / demo only. Not a medical device. Not clinically validated. Every
> patient and vital sign in this repository is synthetic and
> fabricated. Nothing here may be used to make a decision about a real person.**

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
30–90 seconds as the local model works through the 18-patient cohort. Watch the
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

## The two-minute demo

The dashboard opens with a **Demo narrative** strip at the top containing two
cards. Each states a claim and has a button that moves the simulation to the
moment that proves it.

### Story 1 — silent deterioration

**M. Mehra**, 58, arrived 12 simulated minutes ago with *"indigestion and mild
jaw ache after yard work"*. He is diabetic, his father had an MI at 61, and he is
visibly diaphoretic — but **every arrival vital is normal. NEWS 0.** A nurse has
already downgraded him one ESI level: *"Ambulatory and comfortable; symptoms
consistent with reflux."*

He sits at **queue position #14 of 18, status Stable.** Under a static intake
score, that is where he stays for his entire wait.

Press **"Fast-forward 90 min & open his chart"**:

| | At arrival | +90 min |
|---|---|---|
| Queue position | #14 | **#9 (▲5)** |
| Status | Stable | **Escalated** |
| Urgency | 57.7 | **92.6** |
| NEWS | 0 | **6** |
| HR | 84 | 111 |
| Systolic BP | 132 | 103 |
| Resp rate | 17 | 21 |
| SpO₂ | 97% | 95% |

He crossed the escalation threshold at **+78 minutes** into his wait. The patient
drawer shows the entire arithmetic — every term of the urgency formula, a
projection chart of his urgency across the whole wait with the escalation
threshold and "now" marked, and the arrival-vs-current value of each vital with
its NEWS contribution.

Nothing about this required the model to be *right* on arrival. It only required
the system to keep looking.

### Story 2 — a gap in the override layer

**This system records nothing about who a patient is.** There is no ethnicity,
community, region, religion, language, caste or payer column in the data model —
so there is none to audit. That is a deliberate constraint, and the audit does
not need one. It holds the override layer to account on two axes that require no
profiling at all.

Press **"Open the equity audit"**. It reports:

- **Every downgrade landed on someone who walked in.** 5 of 10 walk-in patients
  were downgraded by a nurse override, versus 0 of 8 who arrived by ambulance or
  on referral. Arrival route is an encounter fact, not an attribute of the
  person — and it is a documented anchor on triage judgement: a patient who walks
  in gets under-triaged relative to a clinically identical patient delivered by
  ambulance.
- **The gap survives severity matching.** Restricted to patients whose measured
  physiology is comparably abnormal (NEWS ≥ 3), walk-ins still average a less
  urgent acuity than everyone else. "They were less sick" does not explain it,
  because NEWS says they were not.
- **Three downgrades contradicted the patient's own vital signs.** This check
  uses no grouping variable whatsoever — each patient is compared only against
  themselves. It is the stronger of the two axes and the one worth watching,
  because it fires on the *first* unsafe override rather than waiting for a
  statistically detectable pattern to accumulate.

The justifications attached to those overrides are visible in each patient's
drawer, and they are the point: *"Frequent presenter; likely gastritis."*
*"Requesting analgesia by name; no documented red-flag features."* *"Pain score
inconsistent with observed behaviour"* — on a patient with sickle cell disease
and a documented personal care plan. None of them cite a vital sign.

The panel is labelled **audit only**, and it means it: nothing in
[`src/lib/equity.ts`](src/lib/equity.ts) writes to a patient. It is a read-only
computation over the cohort.

---

## How AI is used, module by module

### Module 1 — Synthetic patient generator ([`src/lib/seed.ts`](src/lib/seed.ts))

No AI. 18 hand-authored synthetic cases: age, sex, arrival route, chief
complaint, narrative history, five vitals, and an arrival time. Several are
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

## Scalability

The prototype is a single-process in-memory store, which is the right choice for a
hackathon and the wrong choice for a department. What would have to change, and
what would not:

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
    urgency.ts     NEWS + the time-decay urgency formula (no AI)
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
npm test           # vitest — 37 unit tests over the urgency model and the audit statistics
npm run test:watch
```

Tests cover the parts where a silent error would be worst: NEWS band boundaries
vital-by-vital, urgency term decomposition and monotonicity, the wait-pressure
cap, staleness and inflection behaviour in the projection, the Benjamini–Hochberg
step-up rule, and — importantly — that `validateScore` drops hallucinated risk
factors, so nothing the model invents can ever reach an urgency weight.

## Data and privacy

No real patient data is used, stored, or transmitted, and none may be. All 18
patients are fabricated in [`src/lib/seed.ts`](src/lib/seed.ts) — names are
randomly assembled and correspond to no one. There is no database, no persistence
to disk, and no telemetry. All model inference is local: the only network
connection the application makes is to `127.0.0.1:11434`.
