// weekly.ts — weekly DIET adaptation, run here on Render (no function timeout) instead
// of on the app's Vercel cron (Hobby caps functions at 60s and the diet Claude call
// runs ~60–90s, so it was being killed mid-generation and writing nothing). The app's
// daily cron computes adherence + builds the (deterministic) workout, then POSTs the
// context here; this module makes the one slow Claude call and writes the diet + report.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { loadPrompt } from "./generate.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ── Structured-output schema (mirrors the app's lib/weekly/schema.ts exactly, so the
//    diet_plans.plan_json this writes is read back unchanged by the app). ──
const WeekdayEnum = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

const MealSchema = z.object({
  name: z.string(),
  time: z.string(),
  items: z.array(z.string()),
  protein_g: z.number(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fiber_g: z.number().nullable(),
  kcal: z.number(),
  swaps: z.array(z.string()),
});

const DietDaySchema = z.object({
  day: WeekdayEnum,
  target_kcal: z.number(),
  protein_target_g: z.number(),
  carbs_target_g: z.number().nullable(),
  fat_target_g: z.number().nullable(),
  fiber_target_g: z.number().nullable(),
  meals: z.array(MealSchema),
});

const DietWeekSchema = z.object({
  week_number: z.number(),
  days: z.array(DietDaySchema),
});

export const WeeklyAdaptationSchema = z.object({
  adapted_diet_plan: DietWeekSchema,
  trainer_note: z.string(),
  updated_supplement_recommendations: z.string(),
  next_week_focus: z.string(),
});
export type WeeklyAdaptation = z.infer<typeof WeeklyAdaptationSchema>;
export type DietWeek = z.infer<typeof DietWeekSchema>;

// ── The adaptation rules + output contract (ported verbatim from the app's adaptPlan.ts
//    so behaviour is identical to the previous on-Vercel generation). ──
const ADAPTATION_RULES = `
=== ADAPTATION RULES (apply based on the adherence_summary) ===
- IF diet_adherence_pct < 70 AND top_diet_miss_reason = "didnt_enjoy_food":
    swap the flagged meal types for alternatives in the same macro range.
- IF workout_adherence_pct < 60 AND the miss reason was being too busy:
    reduce weekly sessions by 1, keep intensity, add one home-session option.
- IF avg_sleep_hours < 6.5 this week:
    reduce workout volume ~15%, add a recovery note to the trainer_note, and note that
    Superhuman and Turkesterone underperform without sleep.
- IF weight_delta is small (< 0.2 kg absolute) AND diet_adherence_pct > 80:
    adjust target calories (-150 for fat loss, +100 for muscle gain) and explain the change
    in the trainer_note.
- IF supplement_streak_days = 7: acknowledge it explicitly in the trainer_note (this is rare).
- IF injury_flagged = true: remove the affected muscle group from next week's workout and add
    "If pain persists beyond 3 days, see a physio" to the trainer_note.`;

const OUTPUT_INSTRUCTION = `
=== OUTPUT ===
Return ONLY the structured object. adapted_diet_plan must have week_number = the next_week_number
given, and exactly 7 day objects (Mon..Sun). The diet must keep the customer's goal, diet type, and
meal count. Give every meal protein_g, carbs_g, fat_g, fiber_g and kcal, and set each day's
carbs_target_g / fat_target_g / fiber_target_g — mirror the macro structure of original_plan. (The
workout is generated separately — do NOT produce a workout plan.) Keep the brand
voice; obey every banned phrase rule. trainer_note is written directly to the customer (second
person, specific, no fluff). Keep next week's target calories within ~150 kcal of original_plan's
unless an adaptation rule above explicitly calls for a change — do not recalculate from scratch.`;

export type WeeklyDietInput = {
  goal: string;
  // Only week_number is read here; the whole object is passed to the model as context.
  summary: { week_number: number };
  originalPlan: unknown;
  nextWeek: number;
};

function validate(out: WeeklyAdaptation, nextWeek: number): string[] {
  const problems: string[] = [];
  if (out.adapted_diet_plan.days.length !== 7) problems.push("diet plan must have 7 days");
  if (out.adapted_diet_plan.week_number !== nextWeek) problems.push("diet week_number mismatch");
  if (out.adapted_diet_plan.days.some((d) => d.meals.length === 0))
    problems.push("every diet day needs at least one meal");
  return problems;
}

// Generate + validate next week's diet. Retries once on invalid output, then throws.
export async function generateWeeklyDiet(input: WeeklyDietInput): Promise<WeeklyAdaptation> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot run the weekly diet adaptation.");
  }
  const model = process.env.WEEKLY_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic();
  const { systemPrompt } = await loadPrompt();
  const system = [systemPrompt, ADAPTATION_RULES, OUTPUT_INSTRUCTION].join("\n\n");

  const userMessage = JSON.stringify(
    {
      goal: input.goal,
      week_just_completed: input.summary.week_number,
      next_week_number: input.nextWeek,
      adherence_summary: input.summary,
      original_plan: input.originalPlan,
      weekdays: WEEKDAYS,
    },
    null,
    2,
  );

  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    if (attempt === 2 && lastProblems.length) {
      messages.push({
        role: "user",
        content:
          "Your previous output was rejected for:\n" +
          lastProblems.map((p) => `- ${p}`).join("\n") +
          "\n\nReturn a corrected object: adapted_diet_plan with exactly 7 days and the correct next_week_number.",
      });
    }

    const response = await client.messages.parse({
      model,
      max_tokens: 8000,
      system,
      messages,
      output_config: { format: zodOutputFormat(WeeklyAdaptationSchema) },
    });

    const out = response.parsed_output;
    if (!out) {
      lastProblems = ["model returned no structured output"];
      continue;
    }
    const problems = validate(out, input.nextWeek);
    if (problems.length === 0) return out;
    lastProblems = problems;
  }

  throw new Error(`weekly diet adaptation failed validation: ${lastProblems.join("; ")}`);
}
