create table public.issue_relations (
  id uuid primary key default gen_random_uuid(),
  source_issue_id uuid not null references public.issues(id) on delete cascade,
  target_issue_id uuid not null references public.issues(id) on delete cascade,
  type text not null default 'blocks',
  created_at timestamptz not null default now(),
  constraint issue_relations_type_valid check (type in ('blocks')),
  constraint issue_relations_not_self check (source_issue_id <> target_issue_id),
  constraint issue_relations_unique unique (source_issue_id, target_issue_id, type)
);

create index issue_relations_source_issue_id_idx
  on public.issue_relations(source_issue_id);

create index issue_relations_target_issue_id_idx
  on public.issue_relations(target_issue_id);

grant select, insert, delete on public.issue_relations to authenticated;

alter table public.issue_relations enable row level security;

create policy "Users can read relations for their own issues"
  on public.issue_relations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.source_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.target_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can create relations for their own issues"
  on public.issue_relations
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.source_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.target_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete relations for their own issues"
  on public.issue_relations
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.source_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
    and exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_relations.target_issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
