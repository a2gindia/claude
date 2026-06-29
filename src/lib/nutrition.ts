// Deterministic nutrition math (SPEC §5). The model never does this — it receives
// the output and places the numbers. Everything here is pure and unit-tested.
import type {
  ActivityLevel,
  Gender,
  Goal,
  NormalizedSubmission,
  NutritionTargets,
} from "../types.js";

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  Sedentary: 1.2,
  Light: 1.375,
  Moderate: 1.55,
  High: 1.725,
};

// Fat loss: 18% deficit (inside the SPEC's 15–20% band). Muscle gain: 10% surplus.
// Recomposition / Performance: maintenance.
const GOAL_FACTOR: Record<Goal, number> = {
  "Fat loss": 0.82,
  "Muscle gain": 1.1,
  Recomposition: 1.0,
  Performance: 1.0,
};

const PROTEIN_G_PER_KG = 1.8;

const round = (n: number) => Math.round(n);
const round10 = (n: number) => Math.round(n / 10) * 10;
const round5 = (n: number) => Math.round(n / 5) * 5;

/**
 * Mifflin-St Jeor BMR. "Prefer not to say" uses the average of the male (+5) and
 * female (−161) constants (−78) so the estimate sits between the two.
 */
export function bmrMifflinStJeor(
  gender: Gender,
  weightKg: number,
  heightCm: number,
  age: number,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const constant = gender === "Male" ? 5 : gender === "Female" ? -161 : -78;
  return round(base + constant);
}

/** Conservative calorie floor: 1200 for female, 1500 otherwise. */
function calorieFloor(gender: Gender): number {
  return gender === "Female" ? 1200 : 1500;
}

export function computeTargets(
  s: Pick<
    NormalizedSubmission,
    "gender" | "weight_kg" | "height_cm" | "age" | "activity_level" | "goal"
  >,
): NutritionTargets {
  const multiplier = ACTIVITY_MULTIPLIER[s.activity_level] ?? ACTIVITY_MULTIPLIER.Moderate;
  const factor = GOAL_FACTOR[s.goal] ?? 1.0;

  const bmr = bmrMifflinStJeor(s.gender, s.weight_kg, s.height_cm, s.age);
  const maintenance_kcal = round10(bmr * multiplier);
  const kcal_floor = calorieFloor(s.gender);
  const target_kcal = Math.max(round10(maintenance_kcal * factor), kcal_floor);
  const protein_g = round5(PROTEIN_G_PER_KG * s.weight_kg);

  return { bmr, maintenance_kcal, target_kcal, protein_g, kcal_floor, goal: s.goal };
}
