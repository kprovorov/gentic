create extension if not exists btree_gist with schema extensions;

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  display_name text not null,
  normalized_name text generated always as (
    lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  credential_hash text not null,
  setup_state text not null default 'enrolling',
  banned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  process_started_at timestamptz,
  gentic_version text,
  os text,
  arch text,
  configured_capacity integer not null default 1,
  provider_capabilities jsonb not null default '{"providers":{}}'::jsonb,
  constraint workers_user_id_not_blank check (length(btrim(user_id)) > 0),
  constraint workers_display_name_not_blank check (
    length(btrim(display_name)) between 1 and 120
  ),
  constraint workers_credential_hash_not_blank check (
    length(btrim(credential_hash)) between 32 and 512
  ),
  constraint workers_setup_state_valid check (
    setup_state in ('enrolling', 'ready', 'setup_failed')
  ),
  constraint workers_gentic_version_length check (
    gentic_version is null or length(btrim(gentic_version)) between 1 and 100
  ),
  constraint workers_os_length check (
    os is null or length(btrim(os)) between 1 and 100
  ),
  constraint workers_arch_length check (
    arch is null or length(btrim(arch)) between 1 and 100
  ),
  constraint workers_configured_capacity_range check (
    configured_capacity between 1 and 64
  ),
  constraint workers_provider_capabilities_object check (
    jsonb_typeof(provider_capabilities) = 'object'
  ),
  constraint workers_user_normalized_name_unique unique (
    user_id,
    normalized_name
  )
);

create index workers_user_id_idx
  on public.workers(user_id);

create index workers_available_idx
  on public.workers(user_id, setup_state, last_seen_at desc)
  where banned_at is null;

create table public.worker_enrollment_codes (
  code_hash text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint worker_enrollment_codes_hash_not_blank check (
    length(btrim(code_hash)) between 32 and 512
  ),
  constraint worker_enrollment_codes_user_id_not_blank check (
    length(btrim(user_id)) > 0
  ),
  constraint worker_enrollment_codes_expires_after_created check (
    expires_at > created_at
  ),
  constraint worker_enrollment_codes_consumed_after_created check (
    consumed_at is null or consumed_at >= created_at
  )
);

alter table public.worker_enrollment_codes
  add constraint worker_enrollment_codes_one_active_per_user
  exclude using gist (
    user_id with =,
    tstzrange(created_at, expires_at, '[)') with &&
  )
  where (consumed_at is null);

create index worker_enrollment_codes_user_id_idx
  on public.worker_enrollment_codes(user_id);

create index worker_enrollment_codes_active_idx
  on public.worker_enrollment_codes(user_id, expires_at)
  where consumed_at is null;

alter table public.issues
  add column active_worker_id uuid references public.workers(id) on delete set null;

create index issues_active_worker_id_idx
  on public.issues(active_worker_id)
  where active_worker_id is not null;

create or replace function public.ensure_issue_active_worker_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_owner text;
  v_worker_owner text;
begin
  if new.active_worker_id is null then
    return new;
  end if;

  select projects.user_id
    into v_project_owner
    from public.projects
   where projects.id = new.project_id;

  select workers.user_id
    into v_worker_owner
    from public.workers
   where workers.id = new.active_worker_id;

  if v_worker_owner is distinct from v_project_owner then
    raise exception 'Active worker must belong to the issue owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ensure_issue_active_worker_owner
  before insert or update of project_id, active_worker_id
  on public.issues
  for each row
  execute function public.ensure_issue_active_worker_owner();

alter table public.workers enable row level security;
alter table public.worker_enrollment_codes enable row level security;

grant usage on schema public to authenticated;

grant select (
  id,
  user_id,
  display_name,
  normalized_name,
  setup_state,
  banned_at,
  created_at,
  updated_at,
  last_seen_at,
  process_started_at,
  gentic_version,
  os,
  arch,
  configured_capacity,
  provider_capabilities
) on public.workers to authenticated;

grant insert (
  user_id,
  display_name,
  credential_hash,
  setup_state,
  banned_at,
  last_seen_at,
  process_started_at,
  gentic_version,
  os,
  arch,
  configured_capacity,
  provider_capabilities
) on public.workers to authenticated;

grant update (
  display_name,
  credential_hash,
  setup_state,
  banned_at,
  updated_at,
  last_seen_at,
  process_started_at,
  gentic_version,
  os,
  arch,
  configured_capacity,
  provider_capabilities
) on public.workers to authenticated;

grant delete on public.workers to authenticated;

grant select (
  user_id,
  expires_at,
  consumed_at,
  created_at
) on public.worker_enrollment_codes to authenticated;

grant insert (
  code_hash,
  user_id,
  expires_at,
  consumed_at,
  created_at
) on public.worker_enrollment_codes to authenticated;

grant update (consumed_at)
  on public.worker_enrollment_codes
  to authenticated;

grant delete on public.worker_enrollment_codes to authenticated;

grant update(active_worker_id)
  on public.issues
  to authenticated;

create policy "Users can read their own workers"
  on public.workers
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own workers"
  on public.workers
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own workers"
  on public.workers
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own workers"
  on public.workers
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can read their own enrollment codes"
  on public.worker_enrollment_codes
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own enrollment codes"
  on public.worker_enrollment_codes
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own enrollment codes"
  on public.worker_enrollment_codes
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own enrollment codes"
  on public.worker_enrollment_codes
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);
