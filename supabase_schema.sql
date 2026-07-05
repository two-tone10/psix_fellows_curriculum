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
  note text,
  unique (user_id, session_id, task_type, task_index)
);
alter table public.psix_progress_events add column if not exists note text;

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
  email text primary key,
  role text not null default 'admin'
);
alter table public.psix_facilitators add column if not exists role text not null default 'admin';

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

-- ═══════════════════════════════════════════════════════
-- DISCUSSION BOARD (per session)
-- ═══════════════════════════════════════════════════════

create table if not exists public.psix_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  body text not null
);

create table if not exists public.psix_message_votes (
  message_id uuid not null references public.psix_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.psix_messages enable row level security;
alter table public.psix_message_votes enable row level security;

drop policy if exists "signed-in fellows read messages" on public.psix_messages;
create policy "signed-in fellows read messages"
on public.psix_messages for select
using (auth.role() = 'authenticated');

drop policy if exists "fellows post own messages" on public.psix_messages;
create policy "fellows post own messages"
on public.psix_messages for insert
with check (auth.uid() = user_id);

drop policy if exists "fellows edit own messages" on public.psix_messages;
create policy "fellows edit own messages"
on public.psix_messages for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "fellows delete own messages" on public.psix_messages;
create policy "fellows delete own messages"
on public.psix_messages for delete
using (auth.uid() = user_id);

drop policy if exists "signed-in fellows read votes" on public.psix_message_votes;
create policy "signed-in fellows read votes"
on public.psix_message_votes for select
using (auth.role() = 'authenticated');

drop policy if exists "fellows cast own votes" on public.psix_message_votes;
create policy "fellows cast own votes"
on public.psix_message_votes for insert
with check (auth.uid() = user_id);

drop policy if exists "fellows remove own votes" on public.psix_message_votes;
create policy "fellows remove own votes"
on public.psix_message_votes for delete
using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════
-- RESOURCE LIBRARY (shared links & files, browsable by session)
-- ═══════════════════════════════════════════════════════

create table if not exists public.psix_resources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  type text not null check (type in ('link', 'file')),
  title text not null,
  description text,
  url text not null,
  file_name text,
  file_size bigint,
  session_id text
);

alter table public.psix_resources enable row level security;

drop policy if exists "signed-in fellows read resources" on public.psix_resources;
create policy "signed-in fellows read resources"
on public.psix_resources for select
using (auth.role() = 'authenticated');

drop policy if exists "fellows add own resources" on public.psix_resources;
create policy "fellows add own resources"
on public.psix_resources for insert
with check (auth.uid() = user_id);

drop policy if exists "fellows delete own resources" on public.psix_resources;
create policy "fellows delete own resources"
on public.psix_resources for delete
using (auth.uid() = user_id);

-- Storage bucket for uploaded resource files (safe to re-run)
insert into storage.buckets (id, name, public)
values ('psix-resources', 'psix-resources', true)
on conflict (id) do nothing;

drop policy if exists "psix resources public read" on storage.objects;
create policy "psix resources public read"
on storage.objects for select
using (bucket_id = 'psix-resources');

drop policy if exists "psix resources authenticated upload" on storage.objects;
create policy "psix resources authenticated upload"
on storage.objects for insert
with check (bucket_id = 'psix-resources' and auth.role() = 'authenticated');

drop policy if exists "psix resources own delete" on storage.objects;
create policy "psix resources own delete"
on storage.objects for delete
using (bucket_id = 'psix-resources' and auth.uid()::text = (storage.foldername(name))[1]);

-- ═══════════════════════════════════════════════════════
-- SESSION MATERIALS (facilitator-uploaded, fills "Pending" slots live)
--
-- One row per (session, slot). Facilitators upsert onto a slot to
-- replace whatever's there; deleting a row reverts that slot to
-- "Pending" in the fellow view. Slot keys are assigned in app.js's
-- getResourceGroups() — e.g. 'material-slides', 'submit-reflection',
-- 'reading-0'.
-- ═══════════════════════════════════════════════════════

create table if not exists public.psix_session_materials (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id text not null,
  slot_key text not null,
  type text not null check (type in ('link', 'file')),
  title text not null,
  url text not null,
  file_name text,
  file_size bigint,
  uploaded_by_email text,
  uploaded_by_name text,
  unique (session_id, slot_key)
);

alter table public.psix_session_materials enable row level security;

drop policy if exists "signed-in fellows read session materials" on public.psix_session_materials;
create policy "signed-in fellows read session materials"
on public.psix_session_materials for select
using (auth.role() = 'authenticated');

drop policy if exists "facilitators manage session materials" on public.psix_session_materials;
create policy "facilitators manage session materials"
on public.psix_session_materials for all
using (exists (
  select 1 from public.psix_facilitators f
  where f.email = auth.jwt() ->> 'email'
))
with check (exists (
  select 1 from public.psix_facilitators f
  where f.email = auth.jwt() ->> 'email'
));

-- Facilitator-uploaded files live under a session-materials/ prefix in the
-- same public bucket used by the resource library; only facilitators may
-- write there.
drop policy if exists "psix session materials facilitator upload" on storage.objects;
create policy "psix session materials facilitator upload"
on storage.objects for insert
with check (
  bucket_id = 'psix-resources'
  and (storage.foldername(name))[1] = 'session-materials'
  and exists (select 1 from public.psix_facilitators f where f.email = auth.jwt() ->> 'email')
);

drop policy if exists "psix session materials facilitator delete" on storage.objects;
create policy "psix session materials facilitator delete"
on storage.objects for delete
using (
  bucket_id = 'psix-resources'
  and (storage.foldername(name))[1] = 'session-materials'
  and exists (select 1 from public.psix_facilitators f where f.email = auth.jwt() ->> 'email')
);
