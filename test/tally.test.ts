import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyTallySignature, normalizeTallyPayload, type TallyWebhookBody } from "../src/lib/tally.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("verifyTallySignature — correct HMAC over the body passes", () => {
  const secret = "shhh";
  const body = JSON.stringify({ a: 1 });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyTallySignature(sig, secret, body), true);
});

test("verifyTallySignature — accepts when Tally signed the compact stringify but raw differs", () => {
  // Tally signs JSON.stringify(parsed); the raw transmitted body may be formatted differently.
  const secret = "shhh";
  const obj = { a: 1, b: 2 };
  const compact = JSON.stringify(obj); // what Tally signs
  const pretty = JSON.stringify(obj, null, 2); // a differently-formatted "raw body"
  const sig = crypto.createHmac("sha256", secret).update(compact).digest("base64");
  // We pass both candidates (req.body re-stringified, and the raw body) → accepted.
  assert.equal(verifyTallySignature(sig, secret, compact, pretty), true);
});

test("verifyTallySignature — wrong signature fails", () => {
  assert.equal(verifyTallySignature("not-the-signature", "shhh", JSON.stringify({ a: 1 })), false);
});

test("verifyTallySignature — missing signature or secret fails", () => {
  assert.equal(verifyTallySignature(undefined, "secret", "body"), false);
  assert.equal(verifyTallySignature("sig", "", "body"), false);
});

test("normalizeTallyPayload — maps the sample submission", async () => {
  const raw = await readFile(path.resolve(__dirname, "sample-payload.json"), "utf8");
  const s = normalizeTallyPayload(JSON.parse(raw) as TallyWebhookBody);
  assert.equal(s.submission_id, "sub_demo_0001");
  assert.equal(s.email, "rohan@example.com");
  assert.equal(s.gender, "Male");
  assert.equal(s.goal, "Muscle gain");
  assert.equal(s.activity_level, "Moderate");
  assert.equal(s.diet_pref, "Eggetarian");
  assert.equal(s.meals_per_day, 4);
});

test("normalizeTallyPayload — throws when submissionId is missing", () => {
  assert.throws(() => normalizeTallyPayload({ data: { fields: [] } } as TallyWebhookBody), /submissionId/);
});

test("normalizeTallyPayload — real-form labels + verbose option texts (tally.so/r/obGPpb)", () => {
  const opt = (text: string) => ({ id: text, text });
  const body: TallyWebhookBody = {
    data: {
      submissionId: "real_1",
      fields: [
        { key: "n", label: "Full Name", type: "INPUT_TEXT", value: "Niket Kumar" },
        { key: "e", label: "Email Address (where we'll send your diet plan)", type: "INPUT_EMAIL", value: "niket@example.com" },
        { key: "p", label: "Phone Number (WhatsApp)", type: "INPUT_PHONE_NUMBER", value: "+919407612171" },
        { key: "g", label: "Your primary goal", type: "MULTIPLE_CHOICE", value: ["Performance / strength"], options: [opt("Fat loss"), opt("Muscle gain"), opt("Recomposition (fat loss + muscle gain)"), opt("Performance / strength")] },
        { key: "a", label: "How active are you currently?", type: "MULTIPLE_CHOICE", value: ["Sedentary (desk job, no workouts)"], options: [opt("Sedentary (desk job, no workouts)"), opt("Lightly active (1–2 workouts/week)"), opt("Moderately active (3–4 workouts/week)"), opt("Highly active (5–6 workouts/week)")] },
        { key: "t", label: "How many days do you train per week?", type: "MULTIPLE_CHOICE", value: ["4–5"], options: [opt("0–1"), opt("2–3"), opt("4–5"), opt("6+")] },
        { key: "d", label: "Diet preference", type: "MULTIPLE_CHOICE", value: ["Non-vegetarian"], options: [opt("Vegan"), opt("Vegetarian"), opt("Eggetarian"), opt("Non-vegetarian")] },
        { key: "av", label: "Foods you want to avoid", type: "CHECKBOXES", value: ["Eggs", "Gluten (eg- roti, maida, suji)"], options: [opt("Lactose / dairy (like milk, butter, ghee)"), opt("Gluten (eg- roti, maida, suji)"), opt("Eggs"), opt("Red meat (Mutton, Beef)"), opt("None")] },
        { key: "m", label: "Meals per day you prefer", type: "MULTIPLE_CHOICE", value: ["3 meals"], options: [opt("3 meals"), opt("4 meals"), opt("5 meals")] },
        { key: "w", label: "Typical workout time", type: "MULTIPLE_CHOICE", value: ["Morning"], options: [opt("Morning"), opt("Evening")] },
        { key: "med", label: "Any medical condition we should know about?", type: "INPUT_TEXT", value: "NA" },
      ],
    },
  };
  const s = normalizeTallyPayload(body);
  assert.equal(s.name, "Niket Kumar");
  assert.equal(s.email, "niket@example.com");
  assert.equal(s.goal, "Performance");
  assert.equal(s.activity_level, "Sedentary");
  assert.equal(s.training_days, "4–5");
  assert.equal(s.diet_pref, "Non-veg");
  assert.deepEqual(s.foods_to_avoid, ["eggs", "gluten"]);
  assert.equal(s.meals_per_day, 3);
  assert.equal(s.workout_time, "Morning");
  assert.equal(s.medical_condition, ""); // "NA" treated as none
  assert.equal(s.product, ""); // no product field on this form
});
