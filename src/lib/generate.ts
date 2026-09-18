// generate.ts — wire the prompt, call Claude with structured output, validate, retry once.
// Numbers come from nutrition.ts; the model places them and composes meals (SPEC §5).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PlanSchema, type Plan } from "./plan-schema.js";
import type { NormalizedSubmission, NutritionTargets } from "../types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_PATH = path.resolve(__dirname, "../../prompts/diet-plan.md");

export class GenerationError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(`${message}: ${problems.join("; ")}`);
    this.name = "GenerationError";
    this.problems = problems;
  }
}

export interface LoadedPrompt {
  systemPrompt: string;
  bannedPhrases: string[];
}

function between(text: string, startMarker: string, endMarker: string): string | null {
  const s = text.indexOf(startMarker);
  if (s === -1) return null;
  const from = s + startMarker.length;
  const e = text.indexOf(endMarker, from);
  if (e === -1) return null;
  return text.slice(from, e);
}

/**
 * Read the system prompt + banned-phrase list from the prompt doc. Supports two formats:
 *  - Markered: text between <!-- PARTB:START/END --> is the system prompt, and
 *    <!-- BANNED:START/END --> holds a dash list. (The original scaffold format.)
 *  - Marker-less (the authored prompt): the whole file is the system prompt, and the
 *    banned phrases are the quoted items on the prompt's own "BANNED words/phrases:" line.
 */
export async function loadPrompt(promptPath = DEFAULT_PROMPT_PATH): Promise<LoadedPrompt> {
  const md = await readFile(promptPath, "utf8");

  const partB = between(md, "<!-- PARTB:START -->", "<!-- PARTB:END -->");
  const systemPrompt = (partB ?? md)
    .split("\n")
    .filter((l) => !l.includes("<!-- BANNED:START -->") && !l.includes("<!-- BANNED:END -->"))
    .join("\n")
    .trim();
  if (!systemPrompt) throw new Error(`Prompt file ${promptPath} is empty`);

  return { systemPrompt, bannedPhrases: extractBannedPhrases(md) };
}

function extractBannedPhrases(md: string): string[] {
  // Explicit block wins, if present.
  const block = between(md, "<!-- BANNED:START -->", "<!-- BANNED:END -->");
  if (block) {
    return block
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter((l) => l.length > 0);
  }
  // Otherwise pull the quoted phrases from the prompt's own banned line: scan from the
  // first "banned" mention to the end of that section (next "===") so quotes elsewhere
  // (examples, the safety line) are not mistaken for banned phrases.
  const idx = md.search(/banned/i);
  if (idx === -1) return [];
  const rest = md.slice(idx);
  const end = rest.indexOf("===");
  const span = end === -1 ? rest.slice(0, 600) : rest.slice(0, end);
  return [...span.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter((p) => p.length > 0);
}

// Field names mirror the variables the authored prompt references (purchased_product,
// allergies_dislikes, food_budget, workout_time, medical_condition). The calorie/protein
// numbers are computed in code (SPEC §5) and passed as the figures to use — the model
// places them rather than recalculating.
function buildUserMessage(s: NormalizedSubmission, t: NutritionTargets): string {
  const avoid = s.foods_to_avoid.length ? s.foods_to_avoid.join(", ") : "none";
  return [
    "Write this customer's 30-day plan using your system instructions. Return it as the JSON object defined by the response schema — nothing outside the JSON.",
    "",
    "=== FINAL NUMBERS (already computed in code — use these EXACT figures in the summary; do NOT recalculate or change them) ===",
    `maintenance_kcal: ${t.maintenance_kcal}`,
    `target_kcal: ${t.target_kcal}`,
    `protein_g: ${t.protein_g}   // protein target to hit across the meals`,
    `carbs_g: ${t.carbs_g}   // daily carbohydrate target`,
    `fat_g: ${t.fat_g}   // daily fat target`,
    `fiber_g: ${t.fiber_g}   // daily fibre target`,
    `goal: ${t.goal}`,
    "",
    "For EVERY meal, give integer protein_g, carbs_g, fat_g, fiber_g. The meals must sum to the daily protein/carbs/fat targets above (protein is the priority; carbs and fat may each be within ~15%). Use realistic per-food macros for Indian foods.",
    "",
    "=== CUSTOMER INPUTS ===",
    `name: ${s.name}`,
    `age: ${s.age}`,
    `gender: ${s.gender}`,
    `height_cm: ${s.height_cm}`,
    `weight_kg: ${s.weight_kg}`,
    `activity_level: ${s.activity_level}`,
    `training_days_per_week: ${s.training_days}`,
    `workout_time: ${s.workout_time || "(not provided)"}`,
    `diet_pref: ${s.diet_pref}`,
    `allergies_dislikes: ${avoid}`,
    `food_budget: ${s.food_budget || "Moderate"}`,
    `eating_setup: ${s.cooking || "(not provided)"}   // who controls the meals`,
    `meals_per_day: ${s.meals_per_day}   // build EXACTLY this many meals`,
    `purchased_product: ${s.product || "(none captured)"}`,
    `ninety_day_target: ${s.target_text || "(not provided)"}`,
    `medical_condition: ${s.medical_condition || "(none)"}`,
  ].join("\n");
}

/** Semantic checks from §5/§11. Returns a list of problems (empty = valid). */
export function validatePlan(
  plan: Plan,
  s: NormalizedSubmission,
  t: NutritionTargets,
  banned: string[],
): string[] {
  const problems: string[] = [];

  if (plan.meals.length !== s.meals_per_day) {
    problems.push(`meals.length is ${plan.meals.length}, expected ${s.meals_per_day}`);
  }

  const proteinSum = plan.meals.reduce((sum, m) => sum + (Number(m.protein_g) || 0), 0);
  const lo = t.protein_g * 0.85;
  const hi = t.protein_g * 1.15;
  if (proteinSum < lo || proteinSum > hi) {
    problems.push(
      `meal protein sum ${proteinSum}g is outside ±15% of target ${t.protein_g}g (${Math.round(lo)}–${Math.round(hi)})`,
    );
  }

  // Summary protein must also land within ±15% of the computed target.
  if (plan.summary.protein_g < lo || plan.summary.protein_g > hi) {
    problems.push(
      `summary.protein_g ${plan.summary.protein_g} is outside ±15% of target ${t.protein_g}g (${Math.round(lo)}–${Math.round(hi)})`,
    );
  }

  if (plan.summary.target_kcal < t.kcal_floor) {
    problems.push(`summary.target_kcal ${plan.summary.target_kcal} is below floor ${t.kcal_floor}`);
  }

  const haystack = JSON.stringify(plan).toLowerCase();
  for (const phrase of banned) {
    if (haystack.includes(phrase.toLowerCase())) {
      problems.push(`banned phrase present: "${phrase}"`);
    }
  }

  return problems;
}

export interface GenerateResult {
  plan: Plan;
  attempts: number;
  model: string;
}

export interface GenerateOptions {
  promptPath?: string;
  model?: string;
  client?: Anthropic;
}

/** Generate a validated plan. Retries once on invalid output, then throws GenerationError. */
export async function generatePlan(
  s: NormalizedSubmission,
  t: NutritionTargets,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot generate a plan.");
  }

  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic();
  const { systemPrompt, bannedPhrases } = await loadPrompt(opts.promptPath);
  const userMessage = buildUserMessage(s, t);

  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    if (attempt === 2 && lastProblems.length) {
      messages.push({
        role: "user",
        content:
          "Your previous output was rejected for these reasons:\n" +
          lastProblems.map((p) => `- ${p}`).join("\n") +
          "\n\nReturn a corrected JSON object. Place the computed numbers exactly, build exactly the requested number of meals, keep the meal protein total within range, and avoid every banned phrase.",
      });
    }

    const response = await client.messages.parse({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      messages,
      output_config: { format: zodOutputFormat(PlanSchema) },
    });

    const plan = response.parsed_output;
    if (!plan) {
      lastProblems = ["model did not return a JSON object matching the schema"];
      continue;
    }

    const problems = validatePlan(plan, s, t, bannedPhrases);
    if (problems.length === 0) {
      return { plan, attempts: attempt, model };
    }
    lastProblems = problems;
  }

  throw new GenerationError("plan failed validation after retry", lastProblems);
}
