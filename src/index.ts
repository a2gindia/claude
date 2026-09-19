// Server + routes (SPEC §3, §8). Flow: receive Tally webhook -> verify signature ->
// ACK 200 -> enqueue (concurrency-limited) -> normalize -> compute -> generate ->
// write plan -> magic link -> email. External calls retry with backoff; runs are logged
// to generation_logs; failures alert ops and can be replayed via /admin/regenerate.
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { verifyTallySignature, normalizeTallyPayload, type TallyWebhookBody } from "./lib/tally.js";
import { computeTargets } from "./lib/nutrition.js";
import { generatePlan } from "./lib/generate.js";
import {
  writePlan,
  createLoginLink,
  logRun,
  getRunStatus,
  getStoredSubmission,
} from "./lib/supabase.js";
import { sendPlanReady, sendAlertEmail } from "./lib/email.js";
import { sendPlanReadyWhatsApp } from "./lib/whatsapp.js";
import { withRetry } from "./lib/retry.js";
import { ConcurrencyQueue } from "./lib/queue.js";
import type { NormalizedSubmission } from "./types.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY) || 3;

// Bounded async processing. At ~20–30/day this is plenty; BullMQ + Redis is the upgrade path.
const queue = new ConcurrencyQueue(MAX_CONCURRENCY);
// Fast same-process dedupe; generation_logs gives cross-restart idempotency.
const processed = new Set<string>();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Capture the raw body so we can verify the Tally HMAC over the exact bytes.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", running: queue.running, pending: queue.pending });
});

app.post("/webhook/tally", (req: Request, res: Response) => {
  const secret = process.env.TALLY_SIGNING_SECRET ?? "";
  const signature = req.header("tally-signature");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("");

  if (secret) {
    // Tally signs HMAC-SHA256(JSON.stringify(req.body)); try that and the raw body.
    if (!verifyTallySignature(signature, secret, JSON.stringify(req.body), rawBody)) {
      console.warn("[webhook] invalid Tally signature — rejecting");
      res.status(401).json({ error: "invalid signature" });
      return;
    }
  } else {
    console.warn("[webhook] TALLY_SIGNING_SECRET not set — skipping signature check (dev only)");
  }

  // ACK in <2s, then process async via the queue.
  res.status(200).json({ received: true });
  void queue.enqueue(() => processSubmission(req.body as TallyWebhookBody));
});

app.post("/admin/regenerate/:submissionId", (req: Request, res: Response) => {
  const token = process.env.ADMIN_TOKEN ?? "";
  const provided =
    (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.header("x-admin-token") || "";
  if (!token || provided !== token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const submissionId = String(req.params.submissionId);
  res.status(202).json({ status: "regenerating", submissionId });
  void queue.enqueue(() => regenerate(submissionId));
});

/** Core pipeline: generate -> store -> magic link -> email. Store/link retry; email is non-fatal. */
async function runPipeline(submission: NormalizedSubmission): Promise<{ planId: string; attempts: number }> {
  const sid = submission.submission_id;
  const targets = computeTargets(submission);
  console.log(`[pipeline] ${sid} ${submission.email} -> target ${targets.target_kcal} kcal, ${targets.protein_g}g protein`);

  const { plan, attempts } = await generatePlan(submission, targets);
  console.log(`[pipeline] ${sid} plan generated in ${attempts} attempt(s)`);

  const planId = await withRetry(
    () => writePlan({ email: submission.email, phone: submission.phone, name: submission.name, plan_json: plan, intake: submission }),
    { label: `writePlan ${sid}` },
  );
  const magicLink = await withRetry(() => createLoginLink(submission.email, submission.phone), {
    label: `createLoginLink ${sid}`,
  });
  console.log(`[pipeline] ${sid} stored as plan ${planId}; magic login link created`);

  // WhatsApp is the primary "plan ready" channel (email lands in spam). Non-fatal.
  try {
    const r = await withRetry(
      () => sendPlanReadyWhatsApp({ name: submission.name, phone: submission.phone, magicLink }),
      { label: `sendPlanReadyWhatsApp ${sid}` },
    );
    console.log(`[pipeline] ${sid} plan-ready WhatsApp: ${r.sent ? `sent (${r.messageId ?? "ok"})` : `skipped (${r.skipped})`}`);
  } catch (waErr) {
    console.warn(`[pipeline] ${sid} WhatsApp send failed: ${msg(waErr)}`);
  }

  // Email backup is non-fatal: the plan is already stored and replayable.
  try {
    const { id } = await withRetry(
      () => sendPlanReady({ name: submission.name, email: submission.email, magicLink }),
      { label: `sendPlanReady ${sid}` },
    );
    console.log(`[pipeline] ${sid} plan-ready email sent (resend id ${id})`);
  } catch (emailErr) {
    await alertOps(
      `email send failed for ${submission.email} (plan ${planId}): ${msg(emailErr)}. ` +
        `Plan is stored — resend via POST /admin/regenerate/${sid}.`,
    );
  }

  return { planId, attempts };
}

async function processSubmission(body: TallyWebhookBody): Promise<void> {
  let submission: NormalizedSubmission | undefined;
  try {
    submission = normalizeTallyPayload(body);
    const sid = submission.submission_id;

    if (processed.has(sid) || (await getRunStatus(sid)) === "ok") {
      console.log(`[process] ${sid} already handled — skipping (idempotent)`);
      return;
    }
    processed.add(sid);
    await logRun({ submission_id: sid, status: "processing", customer_email: submission.email, submission });

    const { planId, attempts } = await runPipeline(submission);
    await logRun({ submission_id: sid, status: "ok", plan_id: planId, attempts });
    console.log(`[process] ${sid} done`);
  } catch (err) {
    const sid = submission?.submission_id ?? body?.data?.submissionId ?? "";
    if (sid) processed.delete(sid); // allow replay
    console.error(`[process] ${sid} failed:`, msg(err));
    await logRun({ submission_id: sid, status: "failed", error: msg(err) });
    await alertOps(`processing failed for submission ${sid}: ${msg(err)}`);
  }
}

/** Support replay: re-run the pipeline from the stored submission (bypasses dedupe). */
async function regenerate(submissionId: string): Promise<void> {
  try {
    const submission = await getStoredSubmission(submissionId);
    if (!submission) {
      console.error(`[regenerate] ${submissionId}: no stored submission found`);
      await alertOps(`regenerate: no stored submission for ${submissionId} (nothing to replay)`);
      return;
    }
    await logRun({ submission_id: submissionId, status: "processing" });
    const { planId, attempts } = await runPipeline(submission);
    await logRun({ submission_id: submissionId, status: "ok", plan_id: planId, attempts });
    console.log(`[regenerate] ${submissionId} done`);
  } catch (err) {
    console.error(`[regenerate] ${submissionId} failed:`, msg(err));
    await logRun({ submission_id: submissionId, status: "failed", error: msg(err) });
    await alertOps(`regenerate failed for ${submissionId}: ${msg(err)}`);
  }
}

async function alertOps(message: string): Promise<void> {
  const to = process.env.ALERT_TO || "(ALERT_TO unset)";
  console.error(`[ALERT -> ${to}] ${message}`);
  await sendAlertEmail("processing failure", message); // best-effort; no-op unless configured
}

app.listen(PORT, () => {
  console.log(`a2g-plan-service listening on :${PORT} (concurrency ${MAX_CONCURRENCY})`);
  console.log("  GET  /health");
  console.log("  POST /webhook/tally");
  console.log("  POST /admin/regenerate/:submissionId");
});
