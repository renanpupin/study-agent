// The agent's tools. Each one has:
//  - definition: what the model sees (name, description, JSON Schema)
//  - schema: Zod validation of the input, before running
//  - run: the real implementation (fake data here, for study purposes)

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
  "são paulo": { tempC: 24, condition: "cloudy" },
  "rio de janeiro": { tempC: 31, condition: "sunny" },
  curitiba: { tempC: 15, condition: "rainy" },
  lisbon: { tempC: 19, condition: "partly cloudy" },
};

// How many reais 1 unit of each currency is worth.
const FAKE_RATES_TO_BRL: Record<string, number> = { BRL: 1, USD: 5.5, EUR: 6.0 };

const calculator = defineTool({
  definition: {
    name: "calculator",
    description:
      "Evaluates an arithmetic expression and returns the result. Supports + - * / ( ) and decimals with a dot. Use it for any calculation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "E.g. (200 * 6) * 0.9" },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  schema: z.object({ expression: z.string() }),
  run: ({ expression }) => {
    // Only digits and operators are allowed. Never evaluate model input without filtering it.
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      throw new Error(`Invalid expression: ${expression}`);
    }
    const result = Function(`"use strict"; return (${expression});`)() as number;
    if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
    return String(Math.round(result * 1e6) / 1e6);
  },
});

const getWeather = defineTool({
  definition: {
    name: "get_weather",
    description: "Returns the current temperature (Celsius) and weather condition for a city.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "City name, e.g. São Paulo" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  schema: z.object({ city: z.string() }),
  run: ({ city }) => {
    const weather = FAKE_WEATHER[city.trim().toLowerCase()];
    if (!weather) throw new Error(`City not found: ${city}`);
    return JSON.stringify({ city, temperature_c: weather.tempC, condition: weather.condition });
  },
});

const convertCurrency = defineTool({
  definition: {
    name: "convert_currency",
    description: "Converts an amount between currencies. Supported currencies: BRL, USD, EUR.",
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

/** Runs a tool by name. Throws if the tool does not exist, the input is invalid or the execution fails. */
export function executeTool(name: string, input: unknown): string {
  const tool = TOOLS.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.message}`);
  return (tool.run as (input: unknown) => string)(parsed.data);
}
