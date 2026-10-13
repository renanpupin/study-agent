# study-agent

A hello-world AI agent in TypeScript with **observability**, **deterministic evaluation**, **metrics** and **LLM-as-a-judge**. Everything is written by hand, with no frameworks, so you can see each concept working.

The agent answers questions about weather, currency exchange and math using 3 tools backed by fake data.

## Setup

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
```

## Study path

### 1. The agent: `src/agent.ts`

```bash
npm run agent -- "Convert 200 euros to Brazilian reais and tell me how much it is with a 10% discount"
```

Read `runAgent`. An agent is just a loop:

```
question → LLM ──(stop_reason = tool_use)──→ run tools → send results back → LLM → ...
               └─(stop_reason = end_turn)──→ final answer
```

- `src/tools.ts`: what the model sees (`definition`: name, description, JSON Schema) and what actually runs (`run`). The input is validated with Zod before running.
- A tool error **does not bring the agent down**: it comes back as a `tool_result` with `is_error: true`, and the model decides what to do. Try `"What's the weather like in Tokyo?"`.
- `MAX_STEPS` prevents an infinite loop (and an infinite bill).

### 2. Observability: `src/tracing.ts`

Each run produces a **trace** in `traces/<id>.json`: a tree of **spans** (agent → LLM calls → tools), each with duration, tokens, cost and input/output.

```bash
npm run trace          # prints the latest trace as a tree
```

```
├─ [agent] agent.run  4210ms  steps=3 $0.0213
│  ├─ [llm] llm.step_1  1520ms  claude-opus-5-5 in=812 out=95 stop=tool_use  → convert_currency(...)
│  ├─ [tool] tool.convert_currency  0ms  {"amount":200,...} → {"result":1200}
│  ├─ [llm] llm.step_2  ...
```

Look at `src/llm.ts`: **every** model call goes through it, and that is what guarantees nothing stays invisible. This is the same data model as OpenTelemetry; in production you swap this tracer for OTel and send the data to Langfuse, Phoenix, Braintrust or Datadog LLM Observability.

### 3. Deterministic evals: `evals/checks.ts`

Plain code, no LLM: cheap, fast and reproducible.

| Check | Question |
|---|---|
| `tools` | Did it call exactly the expected tools? |
| `contains` | Does the answer contain the expected value? (normalizing `7,006,652` → `7006652`) |
| `steps` | Did it finish within N steps? |
| `completed` | Did it end with `end_turn` (no refusal, no running out of tokens)? |

### 4. LLM-as-a-judge: `evals/judge.ts`

For what code cannot check, another model evaluates the answer against two criteria:

- **correct**: does it meet the case's rubric (`rubric` in the dataset)?
- **grounded**: did every number in the answer come from the tools? (detects hallucinations)

Best practices applied: binary verdict, one criterion per call, a short justification (without asking for step-by-step reasoning, which the API refuses as `reasoning_extraction`), structured output with Zod, and the judge sees the tool calls.

### 5. Run the eval: `evals/run.ts`

```bash
npm run eval
npm run eval -- --only weather-sp,unknown-city
```

Runs the agent over `evals/dataset.jsonl`, applies the checks and the judge, and prints the per-case table plus aggregated metrics (pass rate per check, steps, p50/p95 latency, agent and judge cost). The result is saved to `results/`.

### 6. Experiments: `evals/compare.ts`

```bash
PROMPT_VERSION=v1 npm run eval
PROMPT_VERSION=v2 npm run eval
npm run eval:compare
```

Compares the two most recent runs: metrics side by side and **which cases flipped from PASS to FAIL** (regressions). Also try `AGENT_EFFORT=medium` or `AGENT_MODEL=claude-haiku-5-5` and look at the cost vs. quality trade-off.

### 7. Calibrate the judge: `evals/calibrate.ts`

```bash
npm run judge:calibrate
```

A judge is only useful as a metric if it agrees with a human. `evals/calibration.jsonl` has good and bad answers already labeled by hand; the script measures agreement and Cohen's kappa. Add your own examples, especially the cases where you disagreed with the judge.

## Suggested exercises

1. Add a new tool (e.g. `get_date`) and dataset cases that use it.
2. Write a case where v1 fails and tune the v2 prompt until it passes, without regressing the others.
3. Take a case the judge got wrong, add it to `calibration.jsonl` and improve the criterion.
4. Replace the tracer with OpenTelemetry and send the data to Langfuse or Phoenix.

## Structure

```
src/
  config.ts         models, effort, prompt version, pricing
  llm.ts            Claude call + span with tokens/cost
  tracing.ts        minimal tracer (traces/spans)
  tools.ts          the 3 tools and the executor
  prompts.ts        versioned system prompts (v1, v2)
  agent.ts          the agent loop
  cli.ts            npm run agent
  show-trace.ts     npm run trace
evals/
  dataset.jsonl     test cases
  checks.ts         deterministic evaluations
  judge.ts          LLM-as-a-judge
  run.ts            npm run eval
  compare.ts        npm run eval:compare
  calibration.jsonl human-labeled examples
  calibrate.ts      npm run judge:calibrate
```

Notes: calls use `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so if the model refuses a request, the API automatically retries it on another model. Cost is computed from `usage` and the table in `src/config.ts`.
