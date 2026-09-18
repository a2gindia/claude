// Shared input + computation types for the A2G plan service.
// The generated plan's shape lives in lib/plan-schema.ts (zod, single source of truth).

export type Gender = "Male" | "Female" | "Prefer not to say";
export type Goal = "Fat loss" | "Muscle gain" | "Recomposition" | "Performance";
export type ActivityLevel = "Sedentary" | "Light" | "Moderate" | "High";
export type DietPref = "Vegan" | "Vegetarian" | "Eggetarian" | "Non-veg";

/**
 * The Tally submission, normalized to the §4 schema. This is the canonical
 * internal shape every downstream module consumes.
 */
export interface NormalizedSubmission {
  submission_id: string;
  name: string;
  email: string;
  phone: string;
  /** May be empty — if present, the plan leads with it. */
  product: string;
  age: number;
  gender: Gender;
  height_cm: number;
  weight_kg: number;
  goal: Goal;
  activity_level: ActivityLevel;
  /** "0-1" | "2-3" | "4-5" | "6+" */
  training_days: string;
  diet_pref: DietPref;
  /** subset of: dairy / gluten / eggs / red meat / none */
  foods_to_avoid: string[];
  /** 3 | 4 | 5 — build EXACTLY this many meals */
  meals_per_day: number;
  /** Morning / Afternoon / Evening / Night / "" */
  workout_time: string;
  /** free text, may be "" — if non-empty -> conservative + doctor note */
  medical_condition: string;

  // --- V2 intake (used by the app's workout engine + Week-1 bridge) ---
  /** 90-day goal in the customer's own words, may be "" */
  target_text: string;
  /** Beginner | Intermediate | Advanced */
  experience: string;
  /** Full gym | Home (dumbbells + bands) | Home (bodyweight only) | Mixed */
  equipment: string;
  /** training minutes per session (30 | 45 | 60 | 75) */
  session_minutes: number;
  /** subset of: lower back / knees / shoulders / elbows/wrists / neck / none */
  injuries: string[];
  /** I cook | Family cooks | Tiffin/mess | Eat out often */
  cooking: string;
  /** Lean | Moderate | Flexible */
  food_budget: string;
  /** wants a daily 10k-step target */
  steps_goal: boolean;
  /** typical sleep band, e.g. "6-7 hours" */
  sleep_baseline: string;
}

/**
 * Numbers computed in code (nutrition.ts), NOT by the model. The model places
 * these verbatim and builds meals to hit them.
 */
export interface NutritionTargets {
  bmr: number;
  maintenance_kcal: number;
  target_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  /** the calorie floor that was applied for this customer */
  kcal_floor: number;
  goal: Goal;
}
