create type public.issue_priority as enum (
  'low',
  'medium',
  'high',
  'urgent'
);

alter table public.issues
  add column priority public.issue_priority default 'medium';

update public.issues
set priority = 'medium'
where priority is null;

alter table public.issues
  alter column priority set not null;

create index issues_worker_selection_priority_idx
  on public.issues(status, usage_limit_reset_at, priority desc, updated_at asc)
  where status in ('todo', 'held');
