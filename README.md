# Adaptive Triage

Prototype ED triage assistant. Each patient gets scored once at intake by a
local LLM. After that, the queue re-ranks continuously using plain arithmetic
— no second model call — so a patient quietly deteriorating during the wait
actually moves up the list instead of sitting on their intake number for
hours.

> Prototype on synthetic data. Not a medical device, not clinically validated.

## Run it

```bash
ollama pull llama3.1
ollama serve
npm install
npm run dev
```

Open `localhost:3000`. No `.env` needed. Scores stream in over the first
40–110s as the model works through the cohort. If Ollama isn't running, it
falls back to a rule-based scorer automatically — the demo doesn't die
because a laptop couldn't load a model.

## What actually matters here

- **One LLM call per patient, at intake.** Everything after that — urgency,
  rank, re-assessment triggers — is arithmetic re-evaluated on every read.
  Cheap at volume, and every number can be explained on the spot.
- **Age changes the math, not just the display.** Six age-banded vital-sign
  charts (`src/lib/ews.ts`), because NEWS2 is adult-only and one chart
  over-reads kids and under-reads the elderly in opposite directions.
- **Uncertainty only pushes the score up.** Low model confidence, no prior
  record, a missing vital, paediatric/geriatric age — all add urgency, never
  subtract. Swept across every combination in
  `src/lib/__tests__/urgency.test.ts`.
- **A nurse override always wins**, one click, and every override/model
  call/fallback is logged.
- **Surge doesn't change the scoring.** "Simulate 3× surge" adds patients;
  no threshold moves. Relaxing thresholds under load is how departments
  start under-triaging.

## Layout

```
src/lib/
  scorer.ts     LLM call, schema validation, rule-based fallback
  ews.ts        age-stratified early warning score
  urgency.ts    time-decay + precautionary uplift
  equity.ts     override audit (no demographic data collected, by design)
  seed.ts       21 synthetic patients
src/app/api/    state, clock, override, score, surge, reset
src/components/ dashboard, queue, patient drawer, audit log
```

## Tests

`npm test` — 51 tests. The ones worth reading: paediatric hypotension
scoring (an early draft scored a shocked 3-year-old at 1) and the
one-directional property of the uncertainty uplift.

## Honest limitations

Not validated, not a device. The constants in the urgency formula are
invented — the Evidence tab measures how much each one actually matters
rather than asserting they're right. Vitals are simulated and the demo
cases were authored to be found. Assumed jurisdiction: India DPDP 2023 +
ABDM.
