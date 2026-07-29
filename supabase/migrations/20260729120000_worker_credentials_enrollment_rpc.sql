alter table public.workers
  add column credential_expires_at timestamptz;

alter table public.workers
  add constraint workers_credential_expires_after_created check (
    credential_expires_at is null or credential_expires_at > created_at
  );

create unique index workers_credential_hash_unique
  on public.workers(credential_hash);

create table public.worker_enrollment_exchange_failures (
  rate_limit_key text primary key,
  failed_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint worker_exchange_failures_key_not_blank check (
    length(btrim(rate_limit_key)) between 32 and 512
  ),
  constraint worker_exchange_failures_count_nonnegative check (
    failed_count >= 0
  )
);

alter table public.worker_enrollment_exchange_failures enable row level security;

grant insert (
  rate_limit_key,
  failed_count,
  window_started_at,
  locked_until,
  updated_at
) on public.worker_enrollment_exchange_failures to authenticated;

grant select (
  rate_limit_key,
  failed_count,
  window_started_at,
  locked_until,
  updated_at
) on public.worker_enrollment_exchange_failures to authenticated;

grant update (
  failed_count,
  window_started_at,
  locked_until,
  updated_at
) on public.worker_enrollment_exchange_failures to authenticated;

grant delete on public.worker_enrollment_exchange_failures to authenticated;

create policy "Users cannot read exchange failures through RLS"
  on public.worker_enrollment_exchange_failures
  for select
  to authenticated
  using (false);

create or replace function public.consume_worker_enrollment_code(
  p_code_hash text,
  p_credential_hash text,
  p_display_name text,
  p_gentic_version text,
  p_os text,
  p_arch text,
  p_configured_capacity integer,
  p_provider_capabilities jsonb,
  p_process_started_at timestamptz,
  p_now timestamptz default now()
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.worker_enrollment_codes%rowtype;
  v_base_name text := btrim(regexp_replace(p_display_name, '[[:space:]]+', ' ', 'g'));
  v_candidate_name text;
  v_suffix integer := 1;
  v_worker public.workers%rowtype;
begin
  update public.worker_enrollment_codes
     set consumed_at = p_now
   where code_hash = p_code_hash
     and consumed_at is null
     and expires_at > p_now
   returning *
    into v_code;

  if not found then
    return null;
  end if;

  loop
    if v_suffix = 1 then
      v_candidate_name := v_base_name;
    else
      v_candidate_name := left(v_base_name, greatest(1, 77 - length(v_suffix::text))) || ' ' || v_suffix::text;
    end if;

    begin
      insert into public.workers (
        user_id,
        display_name,
        credential_hash,
        setup_state,
        gentic_version,
        os,
        arch,
        configured_capacity,
        provider_capabilities,
        process_started_at
      ) values (
        v_code.user_id,
        v_candidate_name,
        p_credential_hash,
        'enrolling',
        p_gentic_version,
        p_os,
        p_arch,
        p_configured_capacity,
        p_provider_capabilities,
        p_process_started_at
      )
      returning *
       into v_worker;

      return v_worker;
    exception
      when unique_violation then
        if v_suffix >= 1000 then
          raise;
        end if;
        v_suffix := v_suffix + 1;
    end;
  end loop;
end;
$$;

grant execute on function public.consume_worker_enrollment_code(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  jsonb,
  timestamptz,
  timestamptz
) to authenticated;
