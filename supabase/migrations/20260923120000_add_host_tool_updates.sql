-- One-time "update this tool" commands delivered to hosts over their existing
-- outbound polling channel, the same shape as host_skill_installs. A row asks
-- one host to update one of the CLIs it runs work with (gentic itself, Claude
-- Code, Codex, or the GitHub CLI) and carries the result back to the Settings
-- dialog that submitted it. Rows are transient: they are swept once the
-- retention window passes, and this is not an update history.

create table public.host_tool_updates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  host_id uuid not null,
  tool text not null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  finished_at timestamptz,
  summary text,
  output text,
  version text,
  constraint host_tool_updates_user_id_not_blank check (
    length(btrim(user_id)) > 0
  ),
  constraint host_tool_updates_tool_valid check (
    tool in ('gentic', 'claude_code', 'codex', 'github')
  ),
  constraint host_tool_updates_status_valid check (
    status in ('waiting', 'updating', 'updated', 'failed', 'timed-out')
  ),
  constraint host_tool_updates_expires_after_created check (
    expires_at > created_at
  ),
  constraint host_tool_updates_summary_length check (
    summary is null or length(summary) <= 500
  ),
  constraint host_tool_updates_output_length check (
    output is null or length(output) <= 20000
  ),
  constraint host_tool_updates_version_length check (
    version is null or length(version) between 1 and 100
  ),
  -- The composite key (added for host_skill_installs) keeps a command's
  -- user_id from ever drifting from the owner of the host it targets.
  constraint host_tool_updates_host_owner foreign key (host_id, user_id)
    references public.hosts (id, user_id) on delete cascade
);

-- Several tools may be queued for one host, but the same tool only once: a
-- second click on "Update Codex" conflicts here instead of racing the first.
create unique index host_tool_updates_one_pending_per_tool_idx
  on public.host_tool_updates(host_id, tool)
  where status in ('waiting', 'updating');

-- Package managers do not tolerate concurrent runs and a gentic update
-- restarts the host, so a host runs at most one update at a time. The host
-- serialises its own claims; this makes two concurrent polls unable to both
-- succeed.
create unique index host_tool_updates_one_updating_per_host_idx
  on public.host_tool_updates(host_id)
  where status = 'updating';

-- The host's claim query: its oldest undelivered command.
create index host_tool_updates_claimable_idx
  on public.host_tool_updates(host_id, created_at)
  where status = 'waiting';

-- The dialog's result poll and the retention sweep.
create index host_tool_updates_user_created_idx
  on public.host_tool_updates(user_id, created_at desc);

-- Access is entirely server-mediated: the web app authorizes the owner and the
-- agent API authorizes the host credential, both through the service client.
-- No grants to `authenticated` means no other account can read or claim a
-- command even if a token reaches the Data API directly.
alter table public.host_tool_updates enable row level security;
