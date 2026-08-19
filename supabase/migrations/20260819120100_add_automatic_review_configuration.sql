-- Automatic Code Review configuration and the per-Issue policy snapshot.
--
-- Review policy is layered: a Project sets defaults (whether review is enabled,
-- which reviewer provider/model to use, and additive reviewer instructions), an
-- Issue may override enablement, and the *effective* policy is frozen into
-- `issue_review_policies` the moment the Issue's first pull request is
-- associated. Freezing the policy is what lets later Project edits leave
-- in-flight Issues untouched.

-- Project-level defaults. A null provider/model means "Same as Issue": the
-- reviewer follows whatever provider/model the Issue itself uses.
alter table public.projects
  add column automatic_review_enabled boolean not null default false,
  add column automatic_review_provider text,
  add column automatic_review_model text,
  add column automatic_review_instructions text,
  add constraint projects_automatic_review_provider_valid check (
    automatic_review_provider is null
    or automatic_review_provider in ('claude_code', 'codex')
  ),
  add constraint projects_automatic_review_model_not_blank check (
    automatic_review_model is null
    or length(trim(automatic_review_model)) > 0
  ),
  add constraint projects_automatic_review_instructions_length check (
    automatic_review_instructions is null
    or length(automatic_review_instructions) <= 10000
  );

-- Issue-level enablement override. Null inherits the Project default; a concrete
-- true/false overrides it. The override may only change before the first pull
-- request is associated (enforced by trigger below).
alter table public.issues
  add column automatic_review_enabled boolean;

-- The frozen, effective policy for an Issue. Exactly one row per Issue, created
-- when its first pull request is associated and immutable thereafter.
create table public.issue_review_policies (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  enabled boolean not null,
  reviewer_provider text not null,
  reviewer_model text,
  reviewer_instructions text,
  created_at timestamptz not null default now(),
  constraint issue_review_policies_reviewer_provider_valid check (
    reviewer_provider in ('claude_code', 'codex')
  ),
  constraint issue_review_policies_reviewer_model_not_blank check (
    reviewer_model is null
    or length(trim(reviewer_model)) > 0
  )
);

-- Capture the effective policy the first time a pull request is associated with
-- the Issue. Provider/model fall back to the Issue's own provider/model when the
-- Project leaves them "Same as Issue".
create or replace function public.snapshot_issue_review_policy()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_policy record;
begin
  if exists (
    select 1
      from public.issue_review_policies
     where issue_review_policies.issue_id = new.issue_id
  ) then
    return new;
  end if;

  select
    coalesce(i.automatic_review_enabled, p.automatic_review_enabled) as enabled,
    coalesce(p.automatic_review_provider, i.agent_provider) as reviewer_provider,
    coalesce(p.automatic_review_model, i.issue_model) as reviewer_model,
    p.automatic_review_instructions as reviewer_instructions
    into v_policy
    from public.issues as i
    join public.projects as p on p.id = i.project_id
   where i.id = new.issue_id;

  if not found then
    return new;
  end if;

  insert into public.issue_review_policies (
    issue_id,
    enabled,
    reviewer_provider,
    reviewer_model,
    reviewer_instructions
  ) values (
    new.issue_id,
    v_policy.enabled,
    v_policy.reviewer_provider,
    v_policy.reviewer_model,
    v_policy.reviewer_instructions
  )
  on conflict (issue_id) do nothing;

  return new;
end;
$$;

create trigger snapshot_issue_review_policy
  after insert on public.issue_pull_requests
  for each row
  execute function public.snapshot_issue_review_policy();

-- The captured snapshot never changes; that immutability is the whole point.
create or replace function public.enforce_issue_review_policy_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.enabled is distinct from old.enabled
     or new.reviewer_provider is distinct from old.reviewer_provider
     or new.reviewer_model is distinct from old.reviewer_model
     or new.reviewer_instructions is distinct from old.reviewer_instructions then
    raise exception 'Issue review policy snapshot is immutable once captured'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_issue_review_policy_immutable
  before update on public.issue_review_policies
  for each row
  execute function public.enforce_issue_review_policy_immutable();

-- The Issue-level override is only meaningful before a policy is frozen, so lock
-- it once the first pull request has been associated.
create or replace function public.enforce_issue_review_override_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.automatic_review_enabled is distinct from old.automatic_review_enabled
     and exists (
       select 1
         from public.issue_pull_requests
        where issue_pull_requests.issue_id = new.id
     ) then
    raise exception 'Issue automatic review override cannot change after a pull request is associated'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_issue_review_override_immutable
  before update of automatic_review_enabled on public.issues
  for each row
  execute function public.enforce_issue_review_override_immutable();

alter table public.issue_review_policies enable row level security;

grant select on public.issue_review_policies to authenticated;
grant select, insert, update, delete on public.issue_review_policies to service_role;

create policy "Users can read review policy for their own issues"
  on public.issue_review_policies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_review_policies.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

alter table public.issue_review_policies replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'issue_review_policies'
  ) then
    alter publication supabase_realtime add table public.issue_review_policies;
  end if;
end $$;

revoke all on function public.snapshot_issue_review_policy() from public;
revoke all on function public.enforce_issue_review_policy_immutable() from public;
revoke all on function public.enforce_issue_review_override_immutable() from public;

grant execute on function public.snapshot_issue_review_policy() to authenticated;
grant execute on function public.snapshot_issue_review_policy() to service_role;
grant execute on function public.enforce_issue_review_policy_immutable() to authenticated;
grant execute on function public.enforce_issue_review_policy_immutable() to service_role;
grant execute on function public.enforce_issue_review_override_immutable() to authenticated;
grant execute on function public.enforce_issue_review_override_immutable() to service_role;
