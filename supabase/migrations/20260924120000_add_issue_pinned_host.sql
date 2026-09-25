-- Let an issue be pinned to one host. `pinned_host_id` is a standing
-- preference, unlike `active_host_id`, which is a run lease that only exists
-- while a host holds the issue: when set, only that host may claim the issue;
-- when null, any eligible host may claim it (the existing shared-queue
-- behaviour). The pin survives bans, requeues and run resets, because it
-- records what the user asked for rather than what is currently happening;
-- it is cleared only when the pinned host is deleted, via the FK.
alter table public.issues
  add column pinned_host_id uuid
    constraint issues_pinned_host_id_fkey
    references public.hosts(id) on delete set null;

comment on column public.issues.pinned_host_id is
  'Host that must run this issue; null lets any eligible host claim it. Cleared when the host is deleted, kept across bans, requeues and resets.';

-- The claim path filters `pinned_host_id is null or pinned_host_id = <host>`;
-- pinned issues are the minority, so only they need an index entry.
create index issues_pinned_host_id_idx
  on public.issues (pinned_host_id)
  where pinned_host_id is not null;
