// The generated plan's shape — single source of truth for both the structured-output
// schema sent to Claude (via zodOutputFormat) and the TypeScript Plan type.
// Mirrors §5 of SPEC.md. zod v4 is what @anthropic-ai/sdk/helpers/zod expects.
import * as z from "zod/v4";

export const PlanMealSchema = z.object({
  name: z.string(),
  time: z.string(),
  items: z.array(z.string()),
  protein_g: z.number().int(),
  carbs_g: z.number().int(),
  fat_g: z.number().int(),
  fiber_g: z.number().int(),
  swaps: z.array(z.string()),
});

export const PlanSchema = z.object({
  greeting: z.string(),
  summary: z.object({
    maintenance_kcal: z.number().int(),
    target_kcal: z.number().int(),
    protein_g: z.number().int(),
    carbs_g: z.number().int(),
    fat_g: z.number().int(),
    fiber_g: z.number().int(),
    goal: z.string(),
  }),
  meals: z.array(PlanMealSchema),
  training_note: z.string(),
  supplement_usage: z.object({
    product: z.string(),
    how_to_use: z.string(),
  }),
  supplement_gaps: z.array(
    z.object({
      product: z.string(),
      role: z.string(),
    }),
  ),
  safety_note: z.string(),
  closing: z.string(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanMeal = z.infer<typeof PlanMealSchema>;
