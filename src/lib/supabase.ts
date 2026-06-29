// Supabase integration (SPEC §6/§7) — writes a finished plan into the SHARED plans
// table the A2G app reads, and mints a one-tap magic login link for a brand-new
// customer. Uses the service-role key (server-side only); it bypasses RLS, which is
// why writes succeed even though `plans` only exposes a select policy.
//
// The app's supabase/schema.sql owns the table; we only write to it:
//   plans(id uuid pk default, customer_email, customer_phone, customer_name,
//         plan_json jsonb NOT NULL, user_id uuid -> profiles(id) [left null],
//         created_at timestamptz default now())
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "./plan-schema.js";
import type { NormalizedSubmission } from "../types.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only).");
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

export interface WritePlanInput {
  email: string;
  phone: string;
  name: string;
  plan_json: Plan;
}

/** Insert a finished plan into the existing `plans` table. Returns the new row id. */
export async function writePlan(input: WritePlanInput): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("plans")
    .insert({
      customer_email: input.email,
      customer_phone: input.phone,
      customer_name: input.name,
      plan_json: input.plan_json,
      // id / created_at: table defaults. user_id: left null — the app links it on first login.
    })
    .select("id")
    .single();

  if (error) throw new Error(`writePlan failed: ${error.message}`);
  if (!data?.id) throw new Error("writePlan: insert returned no id");
  return String(data.id);
}

function isAlreadyExists(error: { status?: number; code?: string; message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "email_exists" ||
    error.status === 422 ||
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("already exists")
  );
}

function mentionsPhone(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "phone_exists" || (msg.includes("phone") && !isAlreadyExists(error));
}

/**
 * Ensure an auth user exists for this email (the customer is brand-new). Idempotent:
 * creates a confirmed user, treats "already registered" as found, and falls back to
 * email-only creation if the phone collides with another account. Returns the user id
 * when we created/confirmed it, else null (already existed). The user must exist before
 * a `magiclink` can be generated.
 */
export async function ensureAuthUser(email: string, phone?: string): Promise<string | null> {
  const supabase = getSupabase();

  const create = (withPhone: boolean) => {
    const attrs: { email: string; email_confirm: boolean; phone?: string; phone_confirm?: boolean } = {
      email,
      email_confirm: true, // confirmed -> the magic link logs them straight in
    };
    if (withPhone && phone) {
      attrs.phone = phone;
      attrs.phone_confirm = true;
    }
    return supabase.auth.admin.createUser(attrs);
  };

  let { data, error } = await create(Boolean(phone));

  // Phone already used by a different account -> retry with email only.
  if (error && mentionsPhone(error) && phone) {
    ({ data, error } = await create(false));
  }

  if (error) {
    if (isAlreadyExists(error)) return null; // user already exists — fine for magiclink
    throw new Error(`ensureAuthUser failed: ${error.message}`);
  }
  return data.user?.id ?? null;
}

/**
 * Create a one-tap magic login link, creating-or-finding the auth user first (magiclink
 * requires an existing user). Redirects into APP_URL when set.
 */
export async function createLoginLink(email: string, phone?: string): Promise<string> {
  const supabase = getSupabase();
  await ensureAuthUser(email, phone);

  // Generate a magic-link token, then build a URL that points at the APP's /auth/callback
  // with token_hash + type. The app verifies it server-side via verifyOtp. We do NOT use
  // the raw action_link (it targets Supabase's /auth/v1/verify, which returns the session
  // in a URL fragment that a server-side callback can't read).
  const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`createLoginLink failed: ${error.message}`);

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("createLoginLink: no hashed_token returned");

  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (!appUrl) throw new Error("createLoginLink: APP_URL must be set");
  return `${appUrl}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=/plan`;
}

// ---- Run logging (step 8) — generation_logs. See supabase/generation_logs.sql. ----

export interface RunLog {
  submission_id: string;
  status: "processing" | "ok" | "failed";
  customer_email?: string;
  plan_id?: string | null;
  error?: string | null;
  submission?: NormalizedSubmission;
  attempts?: number;
}

/**
 * Best-effort upsert into generation_logs (keyed by submission_id). NEVER throws —
 * run logging must not break the pipeline. Partial: only the provided fields are written.
 */
export async function logRun(record: RunLog): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      submission_id: record.submission_id,
      status: record.status,
      updated_at: new Date().toISOString(),
    };
    if (record.customer_email !== undefined) row.customer_email = record.customer_email;
    if (record.plan_id !== undefined) row.plan_id = record.plan_id;
    if (record.error !== undefined) row.error = record.error;
    if (record.submission !== undefined) row.submission = record.submission;
    if (record.attempts !== undefined) row.attempts = record.attempts;

    const { error } = await getSupabase().from("generation_logs").upsert(row, { onConflict: "submission_id" });
    if (error) console.warn(`[logRun] generation_logs write skipped: ${error.message}`);
  } catch (err) {
    console.warn(`[logRun] skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Best-effort: returns the stored run status for a submission, or null. */
export async function getRunStatus(submissionId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("generation_logs")
      .select("status")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (error) {
      console.warn(`[getRunStatus] ${error.message}`);
      return null;
    }
    return (data?.status as string) ?? null;
  } catch {
    return null;
  }
}

/** Fetch the stored normalized submission for replay (/admin/regenerate). Throws on error. */
export async function getStoredSubmission(submissionId: string): Promise<NormalizedSubmission | null> {
  const { data, error } = await getSupabase()
    .from("generation_logs")
    .select("submission")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw new Error(`getStoredSubmission failed: ${error.message}`);
  return (data?.submission as NormalizedSubmission) ?? null;
}
