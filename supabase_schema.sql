create table if not exists public.psix_progress_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fellow_name text not null,
  fellow_email text,
  session_id text not null,
  task_type text not null,
  task_index integer not null default 0,
  task_text text not null,
  action text not null check (action in ('checked', 'unchecked')),
  unique (user_id, session_id, task_type, task_index)
);

create table if not exists public.psix_portfolio_artifacts (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fellow_name text not null,
  fellow_email text,
  session_id text not null,
  artifact_label text not null,
  response text not null default '',
  unique (user_id, session_id)
);

create table if not exists public.psix_facilitators (
  email text primary key
);

alter table public.psix_progress_events enable row level security;
alter table public.psix_portfolio_artifacts enable row level security;
alter table public.psix_facilitators enable row level security;

drop policy if exists "fellows read own progress" on public.psix_progress_events;
create policy "fellows read own progress"
on public.psix_progress_events for select
using (auth.uid() = user_id);

drop policy if exists "fellows write own progress" on public.psix_progress_events;
create policy "fellows write own progress"
on public.psix_progress_events for insert
with check (auth.uid() = user_id);

drop policy if exists "fellows update own progress" on public.psix_progress_events;
create policy "fellows update own progress"
on public.psix_progress_events for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "fellows read own artifacts" on public.psix_portfolio_artifacts;
create policy "fellows read own artifacts"
on public.psix_portfolio_artifacts for select
using (auth.uid() = user_id);

drop policy if exists "fellows write own artifacts" on public.psix_portfolio_artifacts;
create policy "fellows write own artifacts"
on public.psix_portfolio_artifacts for insert
with check (auth.uid() = user_id);

drop policy if exists "fellows update own artifacts" on public.psix_portfolio_artifacts;
create policy "fellows update own artifacts"
on public.psix_portfolio_artifacts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Facilitators: a facilitator is any signed-in user whose Google account
-- email appears in psix_facilitators. Add rows here (or via the Supabase
-- table editor) for each person who should see the facilitator dashboard.
--   insert into public.psix_facilitators (email) values ('facilitator@example.edu');

drop policy if exists "facilitators read own row" on public.psix_facilitators;
create policy "facilitators read own row"
on public.psix_facilitators for select
using (auth.jwt() ->> 'email' = email);

drop policy if exists "facilitators read all progress" on public.psix_progress_events;
create policy "facilitators read all progress"
on public.psix_progress_events for select
using (exists (
  select 1 from public.psix_facilitators f
  where f.email = auth.jwt() ->> 'email'
));

drop policy if exists "facilitators read all artifacts" on public.psix_portfolio_artifacts;
create policy "facilitators read all artifacts"
on public.psix_portfolio_artifacts for select
using (exists (
  select 1 from public.psix_facilitators f
  where f.email = auth.jwt() ->> 'email'
));
