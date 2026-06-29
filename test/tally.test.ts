import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyTallySignature, normalizeTallyPayload, type TallyWebhookBody } from "../src/lib/tally.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("verifyTallySignature — correct HMAC passes", () => {
  const secret = "shhh";
  const body = JSON.stringify({ a: 1 });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyTallySignature(body, sig, secret), true);
});

test("verifyTallySignature — wrong signature fails", () => {
  const secret = "shhh";
  const body = JSON.stringify({ a: 1 });
  assert.equal(verifyTallySignature(body, "not-the-signature", secret), false);
});

test("verifyTallySignature — missing signature or secret fails", () => {
  assert.equal(verifyTallySignature("body", undefined, "secret"), false);
  assert.equal(verifyTallySignature("body", "sig", ""), false);
});

test("normalizeTallyPayload — maps the sample submission", async () => {
  const raw = await readFile(path.resolve(__dirname, "sample-payload.json"), "utf8");
  const s = normalizeTallyPayload(JSON.parse(raw) as TallyWebhookBody);
  assert.equal(s.submission_id, "sub_demo_0001");
  assert.equal(s.name, "Rohan Mehta");
  assert.equal(s.email, "rohan@example.com");
  assert.equal(s.phone, "+919812345678");
  assert.equal(s.gender, "Male");
  assert.equal(s.goal, "Muscle gain");
  assert.equal(s.activity_level, "Moderate");
  assert.equal(s.diet_pref, "Eggetarian");
  assert.equal(s.meals_per_day, 4);
  assert.equal(s.workout_time, "Evening");
  assert.equal(s.weight_kg, 82);
  assert.deepEqual(s.foods_to_avoid, ["none"]);
});

test("normalizeTallyPayload — throws when submissionId is missing", () => {
  assert.throws(
    () => normalizeTallyPayload({ data: { fields: [] } } as TallyWebhookBody),
    /submissionId/,
  );
});

test("normalizeTallyPayload — variant: vegan / female / 5 meals / multi-avoid / medical / no product", () => {
  const body: TallyWebhookBody = {
    data: {
      submissionId: "sub_v2",
      fields: [
        { key: "e", label: "Email", type: "INPUT_EMAIL", value: "a@b.com" },
        { key: "g", label: "Gender", type: "MULTIPLE_CHOICE", value: ["x"], options: [{ id: "x", text: "Female" }] },
        { key: "go", label: "Primary goal", type: "MULTIPLE_CHOICE", value: ["y"], options: [{ id: "y", text: "Fat loss" }] },
        { key: "d", label: "Diet preference", type: "MULTIPLE_CHOICE", value: ["z"], options: [{ id: "z", text: "Vegan" }] },
        {
          key: "av",
          label: "Foods to avoid",
          type: "CHECKBOXES",
          value: ["a1", "a2"],
          options: [
            { id: "a1", text: "dairy" },
            { id: "a2", text: "gluten" },
          ],
        },
        { key: "m", label: "Meals per day", type: "MULTIPLE_CHOICE", value: ["m5"], options: [{ id: "m5", text: "5" }] },
        { key: "w", label: "Weight (kg)", type: "INPUT_NUMBER", value: 60 },
        { key: "med", label: "Any medical condition?", type: "TEXTAREA", value: "PCOS" },
      ],
    },
  };
  const s = normalizeTallyPayload(body);
  assert.equal(s.gender, "Female");
  assert.equal(s.goal, "Fat loss");
  assert.equal(s.diet_pref, "Vegan");
  assert.equal(s.meals_per_day, 5);
  assert.equal(s.weight_kg, 60);
  assert.deepEqual(s.foods_to_avoid, ["dairy", "gluten"]);
  assert.equal(s.product, ""); // no product field present
  assert.equal(s.medical_condition, "PCOS");
});
