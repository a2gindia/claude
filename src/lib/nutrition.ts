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

// Goal-based protein (g per kg bodyweight). Muscle gain / recomp lean high for
// growth (~2.2–2.3); a fat-loss deficit goes highest to spare muscle. This is the
// coaching baseline — the weekly engine can still nudge from here based on response.
const PROTEIN_G_PER_KG: Record<Goal, number> = {
  "Muscle gain": 2.3,
  "Fat loss": 2.4,
  Recomposition: 2.2,
  Performance: 2.0,
};
const FAT_KCAL_SHARE = 0.25; // ~25% of calories from fat
const FAT_G_PER_KG_FLOOR = 0.6; // hormonal-health floor
const FIBER_G_PER_1000_KCAL = 14; // dietary-guideline density

const round = (n: number) => Math.round(n);
const round10 = (n: number) => Math.round(n / 10) * 10;
const round5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

  const perKg = PROTEIN_G_PER_KG[s.goal] ?? 2.0;
  const protein_g = round5(perKg * s.weight_kg);
  // Fat: ~25% of calories, but never below the hormonal-health floor.
  const fat_g = round5(Math.max((FAT_KCAL_SHARE * target_kcal) / 9, FAT_G_PER_KG_FLOOR * s.weight_kg));
  // Carbs fill whatever calories remain after protein + fat.
  const carbs_g = round5(Math.max(target_kcal - protein_g * 4 - fat_g * 9, 0) / 4);
  const fiber_g = clamp(round((FIBER_G_PER_1000_KCAL * target_kcal) / 1000), 25, 45);

  return { bmr, maintenance_kcal, target_kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_floor, goal: s.goal };
}
