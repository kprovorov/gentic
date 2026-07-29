alter table public.issues
  add column create_pr_automatically boolean not null default false,
  add column has_unpublished_agent_changes boolean not null default false;

alter table public.messages
  add column author_type text not null default 'user',
  add column generated_action text;

alter table public.messages
  add constraint messages_author_type_valid check (
    author_type in ('user', 'agent', 'gentic')
  ),
  add constraint messages_generated_action_valid check (
    generated_action is null
    or generated_action in ('create_pr')
  ),
  add constraint messages_generated_action_gentic_author check (
    generated_action is null
    or author_type = 'gentic'
  );

update public.messages
set author_type = case
  when role = 'user' then 'user'
  when role in ('assistant', 'system') then 'agent'
  else 'gentic'
end
where author_type = 'user';

create index messages_issue_generated_action_idx
  on public.messages(issue_id, generated_action)
  where generated_action is not null;

create or replace function public.normalize_message_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.author_type is null
     or (new.role in ('assistant', 'system') and new.author_type = 'user') then
    new.author_type = case
      when new.role = 'user' then 'user'
      else 'agent'
    end;
  end if;

  return new;
end;
$$;

create trigger normalize_message_metadata
  before insert or update of role, author_type, generated_action
  on public.messages
  for each row
  execute function public.normalize_message_metadata();

create table public.issue_automatic_pr_requests (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  run_id uuid not null,
  requested_by_message_id uuid references public.messages(id) on delete set null,
  create_pr_automatically_snapshot boolean not null default false,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issue_automatic_pr_requests_issue_run_unique unique (issue_id, run_id),
  constraint issue_automatic_pr_requests_status_valid check (
    status in ('pending', 'claimed', 'completed', 'failed', 'skipped')
  )
);

create index issue_automatic_pr_requests_issue_id_idx
  on public.issue_automatic_pr_requests(issue_id);

create index issue_automatic_pr_requests_run_id_idx
  on public.issue_automatic_pr_requests(run_id);

create or replace function public.ensure_issue_automatic_pr_request_active_run()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_create_pr_automatically boolean;
begin
  select issues.create_pr_automatically into v_create_pr_automatically
      from public.issues
     where issues.id = new.issue_id
       and issues.active_run_id = new.run_id;

  if not found then
    raise exception 'Automatic pull request must target the issue active run'
      using errcode = '23514';
  end if;

  new.create_pr_automatically_snapshot = v_create_pr_automatically;

  if new.requested_by_message_id is not null and not exists (
    select 1
      from public.messages
     where messages.id = new.requested_by_message_id
       and messages.issue_id = new.issue_id
       and messages.generated_action = 'create_pr'
  ) then
    raise exception 'Create PR request message must belong to the issue and be marked as create_pr'
      using errcode = '23514';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger ensure_issue_automatic_pr_request_active_run
  before insert or update of issue_id, run_id, requested_by_message_id
  on public.issue_automatic_pr_requests
  for each row
  execute function public.ensure_issue_automatic_pr_request_active_run();

alter table public.issue_automatic_pr_requests enable row level security;

grant select on public.issue_automatic_pr_requests to authenticated;
grant select, insert, update, delete on public.issue_automatic_pr_requests to service_role;

create policy "Users can read automatic PR requests for their own issues"
  on public.issue_automatic_pr_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_automatic_pr_requests.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

revoke all on function public.ensure_issue_automatic_pr_request_active_run()
  from public;
revoke all on function public.normalize_message_metadata()
  from public;

grant execute on function public.ensure_issue_automatic_pr_request_active_run()
  to service_role;
grant execute on function public.normalize_message_metadata()
  to authenticated;
grant execute on function public.normalize_message_metadata()
  to service_role;
