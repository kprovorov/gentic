drop index if exists public.issues_worker_selection_priority_idx;

create index issues_worker_selection_priority_idx
  on public.issues(priority desc, updated_at asc)
  where status in ('todo', 'held');
