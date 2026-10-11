-- feynman.ai: saved practice sessions for signed-in learners.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Each row holds the full server record, including private answer keys, rubrics and extracted upload
-- text. Row Level Security is enabled with NO policies, so the browser (publishable key) can read and
-- write nothing here. Only the feynman.ai API, using SUPABASE_SECRET_KEY, can access this table.

create table if not exists public.practice_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  record jsonb not null,
  title text not null,
  stage text not null,
  lifecycle text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists practice_sessions_user_updated_idx
  on public.practice_sessions (user_id, updated_at desc);

alter table public.practice_sessions enable row level security;
-- Deliberately no policies: deny all for anon and authenticated roles.
revoke all on public.practice_sessions from anon, authenticated;
