// Verify + normalize the Tally webhook payload into the §4 schema.
// Tally sends field IDs/keys, not names — we map by field label (and type), and
// resolve choice option-ids to their text. Confirm Tally's exact signature header
// against their docs at deploy time; we use the documented HMAC-SHA256/base64 scheme.
import crypto from "node:crypto";
import type {
  ActivityLevel,
  DietPref,
  Gender,
  Goal,
  NormalizedSubmission,
} from "../types.js";

interface TallyOption {
  id: string;
  text: string;
}
interface TallyField {
  key: string;
  label?: string;
  type?: string;
  value: unknown;
  options?: TallyOption[];
}
export interface TallyWebhookBody {
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  data?: {
    submissionId?: string;
    responseId?: string;
    formId?: string;
    formName?: string;
    fields?: TallyField[];
  };
}

/** HMAC-SHA256(rawBody, secret) as base64, compared timing-safely to the header. */
export function verifyTallySignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function optionText(field: TallyField, id: string): string {
  return field.options?.find((o) => o.id === id)?.text ?? id;
}

/** Resolve a field's raw value into human text (single) or text[] (multi/checkbox). */
function resolveValue(field: TallyField | undefined): string | string[] | undefined {
  if (!field) return undefined;
  const v = field.value;
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    return v.map((item) => (typeof item === "string" ? optionText(field, item) : String(item)));
  }
  if (typeof v === "string") return field.options ? optionText(field, v) : v;
  return String(v);
}

function findField(
  fields: TallyField[],
  pred: (label: string, type: string) => boolean,
): TallyField | undefined {
  return fields.find((f) => pred((f.label ?? "").toLowerCase().trim(), (f.type ?? "").toUpperCase()));
}

const asString = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v.join(", ") : (v ?? "");

const asArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

const asNumber = (v: string | string[] | undefined): number =>
  Number(asString(v).replace(/[^\d.]/g, ""));

function coerceEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  const found = allowed.find((a) => a.toLowerCase() === value.toLowerCase().trim());
  if (found) return found;
  if (value) console.warn(`[tally] unexpected ${field} "${value}" — defaulting to "${fallback}"`);
  return fallback;
}

export function normalizeTallyPayload(body: TallyWebhookBody): NormalizedSubmission {
  const data = body.data ?? {};
  const fields = data.fields ?? [];

  const submission_id = data.submissionId || data.responseId || "";
  if (!submission_id) throw new Error("Tally payload missing submissionId");

  const get = (pred: (label: string, type: string) => boolean) =>
    resolveValue(findField(fields, pred));

  const meals_raw = asString(get((l) => l.includes("meals")));
  const meals_parsed = parseInt(meals_raw, 10);
  const meals_per_day = [3, 4, 5].includes(meals_parsed) ? meals_parsed : 3;
  if (!Number.isFinite(meals_parsed) || ![3, 4, 5].includes(meals_parsed)) {
    console.warn(`[tally] meals_per_day "${meals_raw}" not 3/4/5 — defaulting to 3`);
  }

  const avoid = asArray(get((l) => l.includes("avoid"))).map((x) => x.toLowerCase().trim());

  return {
    submission_id,
    name: asString(get((l) => l.includes("name") && !l.includes("product"))),
    email: asString(get((l, t) => t === "INPUT_EMAIL" || l.includes("email"))),
    phone: asString(
      get((l, t) => t === "INPUT_PHONE_NUMBER" || l.includes("phone") || l.includes("whatsapp") || l.includes("mobile")),
    ),
    product: asString(get((l) => l.includes("product"))),
    age: asNumber(get((l) => l === "age" || l.includes("age"))),
    gender: coerceEnum<Gender>(
      asString(get((l) => l.includes("gender"))),
      ["Male", "Female", "Prefer not to say"],
      "Prefer not to say",
      "gender",
    ),
    height_cm: asNumber(get((l) => l.includes("height"))),
    weight_kg: asNumber(get((l) => l.includes("weight"))),
    goal: coerceEnum<Goal>(
      asString(get((l) => l.includes("goal"))),
      ["Fat loss", "Muscle gain", "Recomposition", "Performance"],
      "Recomposition",
      "goal",
    ),
    activity_level: coerceEnum<ActivityLevel>(
      asString(get((l) => l.includes("activity"))),
      ["Sedentary", "Light", "Moderate", "High"],
      "Moderate",
      "activity_level",
    ),
    training_days: asString(get((l) => l.includes("training"))),
    diet_pref: coerceEnum<DietPref>(
      asString(get((l) => l.includes("diet"))),
      ["Vegan", "Vegetarian", "Eggetarian", "Non-veg"],
      "Vegetarian",
      "diet_pref",
    ),
    foods_to_avoid: avoid.length ? avoid : ["none"],
    meals_per_day,
    workout_time: asString(get((l) => l.includes("workout"))),
    medical_condition: asString(get((l) => l.includes("medical") || l.includes("condition") || l.includes("health"))),
  };
}
