// Verify + normalize the Tally webhook payload into the §4 schema.
//
// Signature: Tally signs HMAC-SHA256 (base64) of the JSON payload and sends it in the
// `Tally-Signature` header. Per Tally's docs the signed string is JSON.stringify(req.body)
// (the parsed body), which can differ from the raw transmitted bytes — so we verify
// against BOTH the re-stringified parsed body and the raw body, accepting either.
//
// Field mapping: Tally sends field keys + labels + option ids. We map by label keywords
// and resolve choice option-ids to text, then coerce that text to our enums by keyword
// (real-form option texts are verbose, e.g. "Performance / strength", "Non-vegetarian").
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
  label?: string | null;
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

/**
 * HMAC-SHA256(payload, secret) as base64, compared timing-safely to the header. Accepts
 * any of the candidate payloads (JSON.stringify of the parsed body, and/or the raw body).
 */
export function verifyTallySignature(
  signature: string | undefined,
  secret: string,
  ...payloads: Array<string | Buffer | undefined>
): boolean {
  if (!signature || !secret) return false;
  const sig = Buffer.from(signature);
  for (const p of payloads) {
    if (p == null) continue;
    const digest = Buffer.from(crypto.createHmac("sha256", secret).update(p).digest("base64"));
    if (digest.length === sig.length && crypto.timingSafeEqual(digest, sig)) return true;
  }
  return false;
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

/** Map a (possibly verbose) option text to a canonical enum via ordered keyword rules. */
function matchEnum<T extends string>(value: string, rules: Array<[string, T]>, fallback: T): T {
  const v = value.toLowerCase();
  for (const [kw, canon] of rules) if (v.includes(kw)) return canon;
  if (value) console.warn(`[tally] unmatched "${value}" — defaulting to "${fallback}"`);
  return fallback;
}

/** Collapse Tally's verbose "foods to avoid" option texts to clean keywords. */
function cleanAvoid(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    const l = t.toLowerCase();
    if (l.includes("dairy") || l.includes("lactose")) out.add("dairy");
    else if (l.includes("gluten")) out.add("gluten");
    else if (l.includes("egg")) out.add("eggs");
    else if (l.includes("red meat")) out.add("red meat");
    else if (l.includes("none")) out.add("none");
    else if (l.trim()) out.add(l.trim());
  }
  return [...out];
}

/** Treat "NA"/"none"/etc. as no medical condition. */
function cleanMedical(s: string): string {
  const l = s.trim().toLowerCase();
  return ["", "na", "n/a", "none", "no", "nil", "-", "."].includes(l) ? "" : s.trim();
}

export function normalizeTallyPayload(body: TallyWebhookBody): NormalizedSubmission {
  const data = body.data ?? {};
  const fields = data.fields ?? [];

  const submission_id = data.submissionId || data.responseId || "";
  if (!submission_id) throw new Error("Tally payload missing submissionId");

  const get = (pred: (label: string, type: string) => boolean) =>
    resolveValue(findField(fields, pred));

  const mealsRaw = asString(get((l) => l.includes("meals") || l.includes("meal")));
  const mealsParsed = parseInt(mealsRaw, 10);
  const meals_per_day = [3, 4, 5].includes(mealsParsed) ? mealsParsed : 3;

  const avoid = cleanAvoid(asArray(get((l) => l.includes("avoid"))));

  return {
    submission_id,
    name: asString(get((l) => l.includes("name") && !l.includes("product"))),
    email: asString(get((l, t) => t === "INPUT_EMAIL" || l.includes("email"))),
    phone: asString(
      get((l, t) => t === "INPUT_PHONE_NUMBER" || l.includes("phone") || l.includes("whatsapp") || l.includes("mobile")),
    ),
    product: asString(get((l) => l.includes("product"))),
    age: asNumber(get((l) => l === "age" || l.includes("age"))),
    gender: matchEnum<Gender>(
      asString(get((l) => l.includes("gender"))),
      [["female", "Female"], ["male", "Male"], ["prefer", "Prefer not to say"]],
      "Prefer not to say",
    ),
    height_cm: asNumber(get((l) => l.includes("height"))),
    weight_kg: asNumber(get((l) => l.includes("weight"))),
    goal: matchEnum<Goal>(
      asString(get((l) => l.includes("goal"))),
      [
        ["recomp", "Recomposition"],
        ["perform", "Performance"],
        ["strength", "Performance"],
        ["fat loss", "Fat loss"],
        ["fat-loss", "Fat loss"],
        ["muscle", "Muscle gain"],
      ],
      "Recomposition",
    ),
    activity_level: matchEnum<ActivityLevel>(
      asString(get((l) => l.includes("active") || l.includes("activity"))),
      [["sedentary", "Sedentary"], ["light", "Light"], ["moder", "Moderate"], ["high", "High"]],
      "Moderate",
    ),
    training_days: asString(get((l) => l.includes("train"))),
    diet_pref: matchEnum<DietPref>(
      // exclude the email label "…send your diet plan" and the consent "…diet plan is…"
      asString(get((l, t) => l.includes("diet") && !l.includes("plan") && t !== "INPUT_EMAIL")),
      [
        ["vegan", "Vegan"],
        ["eggetarian", "Eggetarian"],
        ["non-veg", "Non-veg"],
        ["nonveg", "Non-veg"],
        ["non veg", "Non-veg"],
        ["vegetarian", "Vegetarian"],
      ],
      "Vegetarian",
    ),
    foods_to_avoid: avoid.length ? avoid : ["none"],
    meals_per_day,
    workout_time: asString(get((l) => l.includes("workout"))),
    medical_condition: cleanMedical(
      asString(get((l) => l.includes("medical") || l.includes("condition") || l.includes("health"))),
    ),
  };
}
