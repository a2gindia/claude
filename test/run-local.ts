// Full end-to-end local run: sample payload -> generate -> write to Supabase ->
// create magic login link -> send the "plan ready" email. Prints the magic link to
// console so you can test login without checking your inbox. Run: `npm run plan`.
//
// Generation uses Claude when ANTHROPIC_API_KEY is set, else a MOCK plan.
// Storage + login link need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ APP_URL).
// Email needs RESEND_API_KEY; if absent, that step is skipped (the link still prints).
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeTallyPayload, type TallyWebhookBody } from "../src/lib/tally.js";
import { computeTargets } from "../src/lib/nutrition.js";
import { generatePlan, validatePlan, loadPrompt } from "../src/lib/generate.js";
import { writePlan, createLoginLink } from "../src/lib/supabase.js";
import { sendPlanReady } from "../src/lib/email.js";
import { mockPlan } from "./mock-plan.js";
import type { Plan } from "../src/lib/plan-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const raw = await readFile(path.resolve(__dirname, "sample-payload.json"), "utf8");
  const payload = JSON.parse(raw) as TallyWebhookBody;

  console.log("\n=== 1. NORMALIZE (tally.ts) ===");
  const submission = normalizeTallyPayload(payload);
  console.log(JSON.stringify(submission, null, 2));

  console.log("\n=== 2. COMPUTE (nutrition.ts) ===");
  const targets = computeTargets(submission);
  console.log(JSON.stringify(targets, null, 2));

  console.log("\n=== 3. GENERATE (generate.ts) ===");
  let plan: Plan;
  let source: string;
  if (process.env.ANTHROPIC_API_KEY) {
    const result = await generatePlan(submission, targets);
    plan = result.plan;
    source = `Claude ${result.model}, ${result.attempts} attempt(s)`;
  } else {
    console.warn("ANTHROPIC_API_KEY not set — using a MOCK plan.");
    plan = mockPlan(submission, targets);
    source = "MOCK (no API key)";
  }
  console.log(`plan source: ${source}`);
  console.log(JSON.stringify(plan, null, 2));

  console.log("\n=== 4. VALIDATION ===");
  const { bannedPhrases } = await loadPrompt();
  const problems = validatePlan(plan, submission, targets, bannedPhrases);
  const proteinSum = plan.meals.reduce((sum, m) => sum + m.protein_g, 0);
  console.log(
    `meals ${plan.meals.length}/${submission.meals_per_day} | protein sum ${proteinSum}g vs target ${targets.protein_g}g | target_kcal ${plan.summary.target_kcal} (floor ${targets.kcal_floor})`,
  );
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "OK — passes all checks.");

  console.log("\n=== 5. STORE PLAN (supabase.ts) ===");
  const planId = await writePlan({
    email: submission.email,
    phone: submission.phone,
    name: submission.name,
    plan_json: plan,
  });
  console.log(`plan row id: ${planId}`);

  console.log("\n=== 6. MAGIC LOGIN LINK (supabase.ts) ===");
  const magicLink = await createLoginLink(submission.email, submission.phone);
  console.log(`magic link: ${magicLink}`);

  console.log("\n=== 7. EMAIL (email.ts via Resend) ===");
  try {
    const { id } = await sendPlanReady({ name: submission.name, email: submission.email, magicLink });
    console.log(`email sent — resend id ${id}`);
  } catch (emailErr) {
    console.warn(`email NOT sent: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`);
    console.warn("(set RESEND_API_KEY in .env to actually send — the magic link below still works.)");
  }

  console.log("\n=== DONE — magic link for testing ===");
  console.log(magicLink);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
