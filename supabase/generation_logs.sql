-- Operational run log for the A2G plan-generation service.
-- This service OWNS this table (it is NOT part of the app's schema). It lives in the
-- same Supabase project. Run this once in the Supabase SQL editor.
--
-- Used for: run status, idempotency across restarts (submission_id PK), and storing the
-- normalized submission so POST /admin/regenerate/:submissionId can replay a failed run.

create table if not exists public.generation_logs (
  submission_id  text primary key,            -- Tally submissionId; idempotency key
  status         text not null,               -- 'processing' | 'ok' | 'failed'
  customer_email text,
  plan_id        uuid,                         -- plans.id on success
  error          text,
  submission     jsonb,                        -- normalized submission, for replay
  attempts       int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists generation_logs_status_idx  on public.generation_logs (status);
create index if not exists generation_logs_created_idx on public.generation_logs (created_at desc);

-- Service-role only. RLS on with no policies = no anon/authenticated access;
-- the server's service-role key bypasses RLS.
alter table public.generation_logs enable row level security;
