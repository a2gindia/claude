-- Additive: store the raw Tally intake on the plan row so the V2 Transformation
-- app's workout engine + Week-1 bridge can read equipment / experience / injuries /
-- session length / goal, etc. Does NOT touch existing columns. Idempotent.
alter table public.plans add column if not exists intake_json jsonb;
