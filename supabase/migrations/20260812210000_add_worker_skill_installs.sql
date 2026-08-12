-- One-time "install this skill" commands delivered to connected workers over
-- their existing outbound polling channel. Rows are transient: they exist only
-- to hand the command to a worker and carry its result back to the dialog that
-- submitted it, and are swept once the retention window passes. This is not an
-- installation history and must never be treated as one.

-- Lets worker_skill_installs carry a composite foreign key so a command's
-- user_id can never drift from the owner of the worker it targets.
alter table public.workers
  add constraint workers_id_user_id_unique unique (id, user_id);

create table public.worker_skill_installs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  worker_id uuid not null,
  source text not null,
  skill text not null,
  url text not null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  output text,
  constraint worker_skill_installs_user_id_not_blank check (
    length(btrim(user_id)) > 0
  ),
  constraint worker_skill_installs_source_valid check (
    source ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
  ),
  constraint worker_skill_installs_skill_valid check (
    skill ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
  ),
  constraint worker_skill_installs_url_length check (
    length(btrim(url)) between 1 and 2048
  ),
  constraint worker_skill_installs_status_valid check (
    status in ('waiting', 'installing', 'installed', 'failed', 'timed-out')
  ),
  constraint worker_skill_installs_expires_after_created check (
    expires_at > created_at
  ),
  constraint worker_skill_installs_error_summary_length check (
    error_summary is null or length(error_summary) <= 500
  ),
  constraint worker_skill_installs_output_length check (
    output is null or length(output) <= 20000
  ),
  constraint worker_skill_installs_worker_owner foreign key (worker_id, user_id)
    references public.workers (id, user_id) on delete cascade
);

-- "Allow only one active skill-install command per worker": a second
-- submission conflicts here rather than racing the first one.
create unique index worker_skill_installs_one_active_per_worker_idx
  on public.worker_skill_installs(worker_id)
  where status in ('waiting', 'installing');

-- The worker's claim query: its own undelivered command, if any.
create index worker_skill_installs_claimable_idx
  on public.worker_skill_installs(worker_id, created_at)
  where status = 'waiting';

-- The dialog's result poll and the retention sweep.
create index worker_skill_installs_user_created_idx
  on public.worker_skill_installs(user_id, created_at desc);

-- Access is entirely server-mediated: the web app authorizes the owner and the
-- agent API authorizes the worker credential, both through the service client.
-- No grants to `authenticated` means no other account can read or claim a
-- command even if a token reaches the Data API directly.
alter table public.worker_skill_installs enable row level security;
