// As ferramentas do agente. Cada uma tem:
//  - definition: o que o modelo vê (nome, descrição, JSON Schema)
//  - schema: validação Zod do input, antes de executar
//  - run: a implementação de verdade (aqui, dados fake para estudo)

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

interface ToolSpec<S extends z.ZodType> {
  definition: Anthropic.Beta.BetaTool;
  schema: S;
  run: (input: z.infer<S>) => string;
}

function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

const FAKE_WEATHER: Record<string, { tempC: number; condition: string }> = {
  "são paulo": { tempC: 24, condition: "nublado" },
  "rio de janeiro": { tempC: 31, condition: "ensolarado" },
  curitiba: { tempC: 15, condition: "chuvoso" },
  lisboa: { tempC: 19, condition: "parcialmente nublado" },
};

// Quantos reais vale 1 unidade de cada moeda.
const FAKE_RATES_TO_BRL: Record<string, number> = { BRL: 1, USD: 5.5, EUR: 6.0 };

const calculator = defineTool({
  definition: {
    name: "calculator",
    description:
      "Avalia uma expressão aritmética e retorna o resultado. Suporta + - * / ( ) e decimais com ponto. Use para qualquer conta.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Ex.: (200 * 6) * 0.9" },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  schema: z.object({ expression: z.string() }),
  run: ({ expression }) => {
    // Só aceitamos dígitos e operadores. Nunca avalie input do modelo sem filtrar.
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      throw new Error(`Expressão inválida: ${expression}`);
    }
    const result = Function(`"use strict"; return (${expression});`)() as number;
    if (!Number.isFinite(result)) throw new Error("Resultado não é um número finito");
    return String(Math.round(result * 1e6) / 1e6);
  },
});

const getWeather = defineTool({
  definition: {
    name: "get_weather",
    description: "Retorna a temperatura atual (Celsius) e a condição do tempo de uma cidade.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "Nome da cidade, ex.: São Paulo" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  schema: z.object({ city: z.string() }),
  run: ({ city }) => {
    const weather = FAKE_WEATHER[city.trim().toLowerCase()];
    if (!weather) throw new Error(`Cidade não encontrada: ${city}`);
    return JSON.stringify({ city, temperature_c: weather.tempC, condition: weather.condition });
  },
});

const convertCurrency = defineTool({
  definition: {
    name: "convert_currency",
    description: "Converte um valor entre moedas. Moedas suportadas: BRL, USD, EUR.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        from: { type: "string", enum: ["BRL", "USD", "EUR"] },
        to: { type: "string", enum: ["BRL", "USD", "EUR"] },
      },
      required: ["amount", "from", "to"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    amount: z.number(),
    from: z.enum(["BRL", "USD", "EUR"]),
    to: z.enum(["BRL", "USD", "EUR"]),
  }),
  run: ({ amount, from, to }) => {
    const converted = (amount * FAKE_RATES_TO_BRL[from]!) / FAKE_RATES_TO_BRL[to]!;
    return JSON.stringify({ amount, from, to, result: Math.round(converted * 100) / 100 });
  },
});

const TOOLS = [calculator, getWeather, convertCurrency];

export const toolDefinitions: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => t.definition);

/** Executa uma tool pelo nome. Lança erro se a tool não existir, o input for inválido ou a execução falhar. */
export function executeTool(name: string, input: unknown): string {
  const tool = TOOLS.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool desconhecida: ${name}`);
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) throw new Error(`Input inválido para ${name}: ${parsed.error.message}`);
  return (tool.run as (input: unknown) => string)(parsed.data);
}
