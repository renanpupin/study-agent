# study-agent

Hello world de um agente de IA em TypeScript com **observabilidade**, **avaliação determinística**, **métricas** e **LLM-as-a-judge**. Tudo escrito à mão, sem frameworks, para ver cada conceito funcionando.

O agente responde perguntas sobre clima, câmbio e contas usando 3 tools com dados fake.

## Setup

```bash
npm install
cp .env.example .env   # e coloque sua ANTHROPIC_API_KEY
```

## Roteiro de estudo

### 1. O agente: `src/agent.ts`

```bash
npm run agent -- "Converta 200 euros para reais e me diga quanto fica com 10% de desconto"
```

Leia `runAgent`. Um agente é só um loop:

```
pergunta → LLM ──(stop_reason = tool_use)──→ executa tools → devolve resultados → LLM → ...
               └─(stop_reason = end_turn)──→ resposta final
```

- `src/tools.ts`: o que o modelo vê (`definition`: nome, descrição, JSON Schema) e o que roda de verdade (`run`). O input é validado com Zod antes de executar.
- Um erro de tool **não derruba o agente**: ele volta como `tool_result` com `is_error: true` e o modelo decide o que fazer. Teste com `"Como está o tempo em Tóquio?"`.
- `MAX_STEPS` evita loop infinito (e conta infinita).

### 2. Observabilidade: `src/tracing.ts`

Cada execução gera um **trace** em `traces/<id>.json`: uma árvore de **spans** (agente → chamadas ao LLM → tools), cada um com duração, tokens, custo e input/output.

```bash
npm run trace          # imprime o último trace como árvore
```

```
├─ [agent] agent.run  4210ms  steps=3 $0.0213
│  ├─ [llm] llm.step_1  1520ms  claude-opus-5-5 in=812 out=95 stop=tool_use  → convert_currency(...)
│  ├─ [tool] tool.convert_currency  0ms  {"amount":200,...} → {"result":1200}
│  ├─ [llm] llm.step_2  ...
```

Repare em `src/llm.ts`: **toda** chamada ao modelo passa por ali, e é isso que garante que nada fica invisível. Esse é o mesmo modelo de dados do OpenTelemetry; em produção você troca este tracer por OTel e envia para Langfuse, Phoenix, Braintrust ou Datadog LLM Observability.

### 3. Evals determinísticos: `evals/checks.ts`

Código puro, sem LLM: barato, rápido e reproduzível.

| Check | Pergunta |
|---|---|
| `tools` | Chamou exatamente as tools esperadas? |
| `contains` | A resposta contém o valor esperado? (com normalização de `7.006.652` → `7006652`) |
| `steps` | Resolveu em até N passos? |
| `completed` | Terminou com `end_turn` (sem recusa, sem estourar tokens)? |

### 4. LLM-as-a-judge: `evals/judge.ts`

Para o que código não consegue checar, outro modelo avalia, com dois critérios:

- **correct**: atende à rubrica do caso (`rubric` no dataset)?
- **grounded**: todo número da resposta veio das tools? (detecta alucinação)

Boas práticas aplicadas: veredito binário, um critério por chamada, justificativa curta (sem pedir o raciocínio passo a passo, que a API recusa como `reasoning_extraction`), saída estruturada com Zod, e o judge vê as chamadas de tools.

### 5. Rodar o eval: `evals/run.ts`

```bash
npm run eval
npm run eval -- --only clima-sp,cidade-desconhecida
```

Roda o agente em `evals/dataset.jsonl`, aplica os checks e o judge, imprime a tabela por caso e as métricas agregadas (pass rate por check, passos, latência p50/p95, custo do agente e do judge). O resultado é salvo em `results/`.

### 6. Experimentos: `evals/compare.ts`

```bash
PROMPT_VERSION=v1 npm run eval
PROMPT_VERSION=v2 npm run eval
npm run eval:compare
```

Compara as duas execuções mais recentes: métricas lado a lado e **quais casos mudaram de PASS para FAIL** (regressões). Teste também `AGENT_EFFORT=medium` ou `AGENT_MODEL=claude-haiku-5-5` e veja o trade-off entre custo e qualidade.

### 7. Calibrar o judge: `evals/calibrate.ts`

```bash
npm run judge:calibrate
```

Um judge só vale como métrica se concordar com um humano. `evals/calibration.jsonl` tem respostas boas e ruins já rotuladas à mão; o script mede a concordância e o Cohen's kappa. Adicione seus próprios exemplos, principalmente os casos em que você discordou do judge.

## Exercícios sugeridos

1. Adicione uma tool nova (ex.: `get_date`) e casos no dataset que a usem.
2. Crie um caso em que o v1 falhe e ajuste o prompt v2 até passar, sem regredir os outros.
3. Pegue um caso que o judge errou, adicione-o em `calibration.jsonl` e melhore o critério.
4. Troque o tracer por OpenTelemetry e envie para o Langfuse ou o Phoenix.

## Estrutura

```
src/
  config.ts         modelos, effort, versão do prompt, preços
  llm.ts            chamada ao Claude + span com tokens/custo
  tracing.ts        tracer mínimo (traces/spans)
  tools.ts          as 3 tools e o executor
  prompts.ts        system prompts versionados (v1, v2)
  agent.ts          o loop do agente
  cli.ts            npm run agent
  show-trace.ts     npm run trace
evals/
  dataset.jsonl     casos de teste
  checks.ts         avaliações determinísticas
  judge.ts          LLM-as-a-judge
  run.ts            npm run eval
  compare.ts        npm run eval:compare
  calibration.jsonl exemplos rotulados por humano
  calibrate.ts      npm run judge:calibrate
```

Notas: as chamadas usam `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), então, se o modelo recusar a requisição, a API refaz a chamada em outro modelo automaticamente. O custo é calculado a partir de `usage` e da tabela em `src/config.ts`.
