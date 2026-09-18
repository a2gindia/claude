// A deterministic, validation-passing plan used by the local harnesses when no
// ANTHROPIC_API_KEY is set (so the rest of the pipeline / storage can be exercised
// without an API call). Clearly labeled [MOCK].
import type { NormalizedSubmission, NutritionTargets } from "../src/types.js";
import type { Plan } from "../src/lib/plan-schema.js";

export function mockPlan(s: NormalizedSubmission, t: NutritionTargets): Plan {
  const n = s.meals_per_day;
  const per = Math.round(t.protein_g / n);
  const proteins = Array.from({ length: n }, (_, i) =>
    i === n - 1 ? t.protein_g - per * (n - 1) : per,
  );
  const names = ["Breakfast", "Mid-morning", "Lunch", "Snack", "Dinner"];
  const times = ["8:00 AM", "11:00 AM", "1:30 PM", "5:00 PM", "8:30 PM"];
  const carbsPer = Math.round(t.carbs_g / n);
  const fatPer = Math.round(t.fat_g / n);
  const fiberPer = Math.round(t.fiber_g / n);

  return {
    greeting: `[MOCK] ${s.name}, the gap between training hard and actually changing is what you eat after — let's close it.`,
    summary: {
      maintenance_kcal: t.maintenance_kcal,
      target_kcal: t.target_kcal,
      protein_g: t.protein_g,
      carbs_g: t.carbs_g,
      fat_g: t.fat_g,
      fiber_g: t.fiber_g,
      goal: t.goal,
    },
    meals: proteins.map((p, i) => ({
      name: names[i] ?? `Meal ${i + 1}`,
      time: times[i] ?? "",
      items: [
        "[mock] balanced plate sized to your day's calories",
        "a protein source that fits your diet preference",
        "vegetables + a complex carb",
      ],
      protein_g: p,
      carbs_g: carbsPer,
      fat_g: fatPer,
      fiber_g: fiberPer,
      swaps: ["swap the carb for another whole grain", "swap the protein for one you prefer"],
    })),
    training_note:
      "[MOCK] Eat a fuller meal around your workout time; on rest days keep protein the same and trim a little starch.",
    supplement_usage: s.product
      ? { product: s.product, how_to_use: `[MOCK] Use ${s.product} as one of your daily protein servings, e.g. after training.` }
      : { product: "", how_to_use: "" },
    supplement_gaps: [{ product: "Creatine", role: "supports training output and recovery" }],
    safety_note: s.medical_condition
      ? "[MOCK] Given your noted condition, keep changes gradual and clear this plan with your doctor first."
      : "[MOCK] Drink more water with the higher protein intake, and adjust portions to your hunger.",
    closing: "[MOCK] Start tomorrow — one meal at a time.",
  };
}
