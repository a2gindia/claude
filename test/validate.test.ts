import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "../src/lib/generate.js";
import type { NormalizedSubmission, NutritionTargets } from "../src/types.js";
import type { Plan } from "../src/lib/plan-schema.js";

const targets: NutritionTargets = {
  bmr: 1788,
  maintenance_kcal: 2770,
  target_kcal: 3050,
  protein_g: 150,
  carbs_g: 380,
  fat_g: 85,
  fiber_g: 40,
  kcal_floor: 1500,
  goal: "Muscle gain",
};

// validatePlan only reads submission.meals_per_day.
const submission = { meals_per_day: 4 } as unknown as NormalizedSubmission;
const banned = ["game-changer", "supercharge"];

function validPlan(): Plan {
  return {
    greeting: "Rohan, let's close the gap between training and results.",
    summary: { maintenance_kcal: 2770, target_kcal: 3050, protein_g: 150, carbs_g: 380, fat_g: 85, fiber_g: 40, goal: "Muscle gain" },
    meals: [
      { name: "Breakfast", time: "8 AM", items: ["eggs"], protein_g: 38, carbs_g: 95, fat_g: 21, fiber_g: 10, swaps: ["x"] },
      { name: "Lunch", time: "1 PM", items: ["dal"], protein_g: 38, carbs_g: 95, fat_g: 21, fiber_g: 10, swaps: ["x"] },
      { name: "Snack", time: "5 PM", items: ["whey"], protein_g: 36, carbs_g: 95, fat_g: 21, fiber_g: 10, swaps: ["x"] },
      { name: "Dinner", time: "9 PM", items: ["paneer"], protein_g: 38, carbs_g: 95, fat_g: 22, fiber_g: 10, swaps: ["x"] },
    ],
    training_note: "eat a fuller meal around training",
    supplement_usage: { product: "", how_to_use: "" },
    supplement_gaps: [],
    safety_note: "a general nutrition guide, not medical advice",
    closing: "start now",
  };
}

test("validatePlan — a good plan passes with no problems", () => {
  assert.deepEqual(validatePlan(validPlan(), submission, targets, banned), []);
});

test("validatePlan — wrong meal count is rejected", () => {
  const p = validPlan();
  p.meals.pop(); // 3 meals, expected 4
  const probs = validatePlan(p, submission, targets, banned);
  assert.ok(probs.some((x) => x.includes("meals.length")), probs.join("; "));
});

test("validatePlan — meal protein outside ±15% is rejected", () => {
  const p = validPlan();
  p.meals[0].protein_g = 5; // sum ~117g, below 127.5 floor of the band
  const probs = validatePlan(p, submission, targets, banned);
  assert.ok(probs.some((x) => x.toLowerCase().includes("protein")), probs.join("; "));
});

test("validatePlan — target_kcal below floor is rejected", () => {
  const p = validPlan();
  p.summary.target_kcal = 1000; // below 1500 floor
  const probs = validatePlan(p, submission, targets, banned);
  assert.ok(probs.some((x) => x.includes("below floor")), probs.join("; "));
});

test("validatePlan — a banned phrase is rejected", () => {
  const p = validPlan();
  p.greeting = "this plan is a game-changer";
  const probs = validatePlan(p, submission, targets, banned);
  assert.ok(probs.some((x) => x.includes("banned phrase")), probs.join("; "));
});
