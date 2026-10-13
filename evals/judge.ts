// LLM-as-a-judge: um modelo avalia a resposta de outro segundo um critério.
//
// Boas práticas aplicadas aqui:
//  - veredito BINÁRIO (pass/fail), bem mais consistente que nota de 1 a 10
//  - um critério por chamada, escrito de forma objetiva
//  - raciocínio ANTES do veredito (o campo reasoning vem primeiro no schema)
//  - saída estruturada (JSON validado por Zod), nada de regex em texto livre
//  - o judge vê as chamadas de tools, então consegue detectar alucinação
//  - calibrar contra rótulos humanos (ver evals/calibrate.ts)

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ToolCall } from "../src/agent";
import { JUDGE_EFFORT, JUDGE_MODEL } from "../src/config";
import { messageCost, parseMessage } from "../src/llm";
import { setAttributes, withSpan } from "../src/tracing";

const Verdict = z.object({
  reasoning: z.string().describe("Análise curta, passo a passo, antes do veredito"),
  pass: z.boolean(),
});

export interface JudgeInput {
  question: string;
  toolCalls: ToolCall[];
  answer: string;
  criterion: string;
}

export interface JudgeResult {
  pass: boolean;
  reasoning: string;
  costUsd: number;
}

// Critério fixo, usado em todos os casos: a resposta inventou algo?
export const GROUNDEDNESS_CRITERION = `Todo dado concreto da resposta (temperaturas, condições do tempo, valores, taxas, resultados de contas) aparece nos resultados das ferramentas ou é derivado corretamente deles. Conhecimento geral amplamente conhecido (ex.: capitais de países) é aceitável. Reprova se houver qualquer número ou fato inventado, estimado ou que contradiga os resultados das ferramentas.`;

const SYSTEM = `Você é um avaliador rigoroso de respostas de um agente de IA.
Avalie SOMENTE o critério pedido, ignorando estilo e tamanho da resposta, a menos que o critério fale disso.
Na dúvida, reprove. Pense passo a passo no campo reasoning e só então decida pass.`;

export async function judge(name: string, input: JudgeInput): Promise<JudgeResult> {
  return withSpan(`judge.${name}`, "eval", async (span) => {
    const response = await parseMessage(
      {
        model: JUDGE_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: JUDGE_EFFORT, format: betaZodOutputFormat(Verdict) },
        messages: [{ role: "user", content: buildPrompt(input) }],
      },
      "llm.judge",
    );
    const verdict = response.parsed_output;
    if (!verdict) throw new Error(`Judge não retornou um veredito válido (stop_reason=${response.stop_reason})`);
    setAttributes(span, { criterion: input.criterion, pass: verdict.pass, reasoning: verdict.reasoning });
    return { ...verdict, costUsd: messageCost(response) };
  });
}

function buildPrompt({ question, toolCalls, answer, criterion }: JudgeInput): string {
  const calls = toolCalls.length
    ? toolCalls
        .map((c) => `- ${c.name}(${JSON.stringify(c.input)}) → ${c.isError ? "ERRO: " : ""}${c.output}`)
        .join("\n")
    : "(nenhuma ferramenta foi chamada)";
  return `<pergunta_do_usuario>
${question}
</pergunta_do_usuario>

<chamadas_de_ferramentas>
${calls}
</chamadas_de_ferramentas>

<resposta_do_agente>
${answer}
</resposta_do_agente>

<criterio>
${criterion}
</criterio>

A resposta do agente atende ao critério?`;
}
