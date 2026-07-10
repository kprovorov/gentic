create table if not exists public.issue_pull_requests (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  constraint issue_pull_requests_url_not_blank check (length(trim(url)) > 0),
  constraint issue_pull_requests_url_unique unique (url)
);

create index if not exists issue_pull_requests_issue_id_idx
  on public.issue_pull_requests(issue_id);

insert into public.issue_pull_requests (issue_id, url)
select id, pr_url
from public.issues
where pr_url is not null
on conflict (url) do nothing;

grant select, delete on public.issue_pull_requests to authenticated;
grant select, insert, update, delete on public.issue_pull_requests to service_role;

alter table public.issue_pull_requests enable row level security;

drop policy if exists "Users can read pull requests for their own issues"
  on public.issue_pull_requests;

create policy "Users can read pull requests for their own issues"
  on public.issue_pull_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_pull_requests.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

drop policy if exists "Users can delete pull requests for their own issues"
  on public.issue_pull_requests;

create policy "Users can delete pull requests for their own issues"
  on public.issue_pull_requests
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_pull_requests.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

alter table public.issue_pull_requests replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'issue_pull_requests'
  ) then
    alter publication supabase_realtime add table public.issue_pull_requests;
  end if;
end $$;
