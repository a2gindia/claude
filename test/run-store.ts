// Step-6 demo: sample payload -> normalize -> compute -> plan -> WRITE to Supabase
// `plans` + create the magic login link (create-or-find the brand-new auth user).
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (and APP_URL for the redirect) in .env.
// Uses a real Claude plan when ANTHROPIC_API_KEY is set, else a MOCK plan (so you can
// test storage without spending an API call). Run: `npm run store`.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeTallyPayload, type TallyWebhookBody } from "../src/lib/tally.js";
import { computeTargets } from "../src/lib/nutrition.js";
import { generatePlan } from "../src/lib/generate.js";
import { writePlan, createLoginLink } from "../src/lib/supabase.js";
import { mockPlan } from "./mock-plan.js";
import type { Plan } from "../src/lib/plan-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const raw = await readFile(path.resolve(__dirname, "sample-payload.json"), "utf8");
  const submission = normalizeTallyPayload(JSON.parse(raw) as TallyWebhookBody);
  const targets = computeTargets(submission);

  let plan: Plan;
  if (process.env.ANTHROPIC_API_KEY) {
    plan = (await generatePlan(submission, targets)).plan;
    console.log("plan source: Claude");
  } else {
    plan = mockPlan(submission, targets);
    console.log("plan source: MOCK (no ANTHROPIC_API_KEY)");
  }

  console.log(`\nWriting plan to Supabase \`plans\` for ${submission.email} …`);
  const planId = await writePlan({
    email: submission.email,
    phone: submission.phone,
    name: submission.name,
    plan_json: plan,
  });
  console.log("  plan row id:", planId);

  console.log("\nCreating magic login link (create-or-find the auth user first) …");
  const loginUrl = await createLoginLink(submission.email, submission.phone);
  console.log("  login URL:", loginUrl);

  console.log("\nStep 6 OK — plan stored and login link created.");
}

main().catch((err) => {
  console.error("step 6 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
