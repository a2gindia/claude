# a2g-plan-service

Generates a personalized one-month A2G diet plan from a Tally submission, using
deterministic nutrition math in code + Claude for the plan content. Built from
`SPEC.md`.

> **Build status: SPEC §11 steps 1–9 are implemented** (email via Resend is live; the full
> webhook→plan→login→render journey is verified end to end). Webhook → verify → ACK →
> concurrency-limited queue → generate → store plan → magic link → email, with backoff
> retries, run logging to `generation_logs`, ops alerts, replay via
> `POST /admin/regenerate/:id`, and a production Dockerfile + deploy docs (below). Bitespeed
> (step 7, email + WhatsApp) is a **stub that only logs — optional / not wired in**.
>
> **One-time setup:** run `supabase/generation_logs.sql` once in the Supabase SQL editor
> (creates the run-log table this service owns). Run logging degrades gracefully until then.

> **The generation prompt** lives in `prompts/diet-plan.md` and is used **verbatim** as
> Claude's system prompt. `generate.ts` supports either the whole file as the prompt
> (current) or text between `PARTB:START/END` markers; banned phrases come from a
> `BANNED:START/END` block if present, else from the prompt's own "BANNED words/phrases:" line.

## Quick start

```bash
npm install
cp .env.example .env        # then fill in at least ANTHROPIC_API_KEY

# Full flow: sample -> generate -> Supabase write -> magic link -> email
npm run plan                # prints the magic link to console; email needs RESEND_API_KEY

# Storage only: write the plan + create the magic login link (no email)
npm run store

npm test                    # unit tests: nutrition, tally, validation, retry, queue
npm run typecheck           # tsc, no emit
npm run dev                 # run the webhook server (tsx watch) on :3000
```

`npm run plan` runs the whole pipeline end to end and prints the magic link so you can
test login without your inbox. Generation falls back to a labeled **MOCK** when
`ANTHROPIC_API_KEY` is absent; storage/link need the Supabase vars; the email step is
skipped (with a notice) when `RESEND_API_KEY` is absent.

## How it works (steps 1–8)

```
POST /webhook/tally
  -> verify Tally signature (TALLY_SIGNING_SECRET; skipped locally if unset)
  -> ACK 200 immediately -> enqueue (concurrency <=3)
  -> tally.ts       normalize the payload to the §4 schema
  -> generation_logs: mark 'processing' (idempotent on submission_id)
  -> nutrition.ts   BMR (Mifflin-St Jeor) -> TDEE -> target kcal + protein (deterministic)
  -> generate.ts    Claude call w/ structured output, validate, retry once
  -> supabase.ts    write plan row to `plans` + magic login link   (retry w/ backoff)
  -> email.ts       send "plan ready" email (Resend)               (retry; non-fatal)
  -> generation_logs: mark 'ok'  (or 'failed' + alert ops; replay via /admin/regenerate)
  -> (deferred)     bitespeed.ts: email + WhatsApp — stub only, not wired
```

The model **never** does the calorie math — `nutrition.ts` computes
`maintenance_kcal`, `target_kcal`, and `protein_g`, and `generate.ts` validates that
the model placed them verbatim, built exactly `meals_per_day` meals, kept meal
protein within ±15% of target, stayed above the calorie floor, and used no banned
phrase. Invalid output is retried once, then raises.

## Configuration

See `.env.example`. Generation needs `ANTHROPIC_API_KEY` (optionally `ANTHROPIC_MODEL`,
default `claude-sonnet-4-6`). Storage/login need `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (service-role, server-side only), and `APP_URL` (the magic
link redirects to `APP_URL/auth/callback`). Email needs `RESEND_API_KEY` and `EMAIL_FROM`
(default `plans@a2glifestyle.com`). Reliability: `MAX_CONCURRENCY` (default 3), `ADMIN_TOKEN`
(guards `/admin/regenerate`), and `ALERT_TO` (ops contact for failures — if it's an email
address, alerts are emailed via Resend). Bitespeed vars are for step 7 (deferred).

## Layout

```
src/
  index.ts          server + routes (/health, /webhook/tally, /admin/regenerate)
  types.ts          input + nutrition types
  lib/
    tally.ts        verify + normalize payload
    nutrition.ts    Mifflin-St Jeor, TDEE, targets (pure, unit-tested)
    generate.ts     Claude call, structured output, validation, retry
    plan-schema.ts  zod schema for the plan (drives structured output + Plan type)
    supabase.ts     write plan row + auth user + magic link + run logging (generation_logs)
    email.ts        "plan ready" email + ops alert email (Resend)
    queue.ts        in-process concurrency limiter (<=3)
    retry.ts        retry-with-backoff for external calls
    bitespeed.ts    email + WhatsApp via Bitespeed (DEFERRED — stub, not wired)
supabase/
  generation_logs.sql   run-log table this service owns (run once in the SQL editor)
prompts/
  diet-plan.md      generation prompt — used verbatim as the system prompt
test/
  sample-payload.json   realistic Tally submission
  run-local.ts          full-flow demo (sample -> plan -> store -> link -> email)
  run-store.ts          storage-only demo (plan -> Supabase + login link)
  mock-plan.ts          shared mock plan for the harnesses (no-API-key path)
  *.test.ts             unit tests: nutrition, tally, validation, retry, queue
```

## Deploy (step 9)

Runs anywhere Node 20+ runs. The server is stateless (the queue is in-process), so a single
instance is plenty at ~20–30 plans/day. `tsx` is a runtime dependency, so there's no build step.

**Prerequisites**
- Supabase: same project as the app, with `supabase/generation_logs.sql` applied.
- Resend: sending domain verified, `EMAIL_FROM` on that domain.
- In production, **set `TALLY_SIGNING_SECRET`** — without it the webhook skips signature checks.

**Option A — Railway / Render (from a Git repo)**
1. Push this repo to GitHub.
2. New service from the repo → Build `npm ci`, Start `npm start` (or just use the Dockerfile).
3. Add the env vars (below). `PORT` is injected by the platform; the server reads it.
4. Deploy, then hit `https://<your-service>/health` → `{"status":"ok"}`.

**Option B — Docker (any VPS)**
```bash
docker build -t a2g-plan-service .
docker run -p 3000:3000 --env-file .env a2g-plan-service
```

**Required env (production):** `ANTHROPIC_API_KEY`, `TALLY_SIGNING_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_TOKEN`.
Optional: `ANTHROPIC_MODEL`, `ALERT_TO`, `MAX_CONCURRENCY`.

**After deploy**
- Point the Tally form's webhook at `https://<your-service>/webhook/tally`; set its signing
  secret to match `TALLY_SIGNING_SECRET`.
- Set `APP_URL` to the production app URL and add `<APP_URL>/auth/callback` to
  **Supabase → Auth → URL Configuration → Redirect URLs**.
- Send one real form submission to confirm the live field-label mapping.

## Next steps (optional)

- **Step 7 — Bitespeed** (only if you want one-tap *unique* links inside WhatsApp): implement
  `src/lib/bitespeed.ts` (currently a logging stub) and wire it after the magic link. Not
  needed if WhatsApp uses a generic login link and email carries the unique link.
