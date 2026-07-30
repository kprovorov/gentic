alter table public.workers
  drop constraint workers_display_name_not_blank;

alter table public.workers
  add constraint workers_display_name_not_blank check (
    length(btrim(display_name)) between 1 and 80
  );

create or replace function public.requeue_worker_active_issues(
  p_worker_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued_count integer := 0;
begin
  with active as (
    select id, active_run_id
      from public.issues
     where active_worker_id = p_worker_id
       and active_run_id is not null
       and status not in ('completed', 'cancelled', 'run-failed')
     for update
  ),
  requeued as (
    update public.issues
       set status = 'todo',
           active_worker_id = null,
           active_run_id = null,
           run_error = null,
           run_started_at = null,
           run_finished_at = null,
           usage_limit_reset_at = null,
           updated_at = p_now
      from active
     where issues.id = active.id
     returning issues.id
  ),
  released_messages as (
    update public.messages
       set consumed_by_run_id = null,
           consumed_at = null,
           updated_at = p_now
      from active
     where messages.issue_id = active.id
       and messages.role = 'user'
       and messages.consumed_by_run_id = active.active_run_id
     returning messages.id
  )
  select count(*)::integer
    into v_requeued_count
    from requeued;

  update public.issues
     set active_worker_id = null,
         active_run_id = null,
         updated_at = p_now
   where active_worker_id = p_worker_id
     and active_run_id is not null
     and status = 'run-failed';

  return v_requeued_count;
end;
$$;

create or replace function public.rename_worker(
  p_user_id text,
  p_worker_id uuid,
  p_display_name text,
  p_now timestamptz default now()
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text :=
    btrim(regexp_replace(p_display_name, '[[:space:]]+', ' ', 'g'));
  v_worker public.workers%rowtype;
begin
  if length(v_display_name) not between 1 and 80 then
    raise exception 'Worker name must be between 1 and 80 characters'
      using errcode = '22023';
  end if;

  update public.workers
     set display_name = v_display_name,
         updated_at = p_now
   where id = p_worker_id
     and user_id = p_user_id
   returning *
    into v_worker;

  if not found then
    return null;
  end if;

  return v_worker;
exception
  when unique_violation then
    raise exception 'Worker name is already in use'
      using errcode = '23505';
end;
$$;

create or replace function public.ban_worker(
  p_user_id text,
  p_worker_id uuid,
  p_now timestamptz default now()
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_ignored integer;
begin
  select *
    into v_worker
    from public.workers
   where id = p_worker_id
     and user_id = p_user_id
   for update;

  if not found then
    return null;
  end if;

  if v_worker.banned_at is null then
    update public.workers
       set banned_at = p_now,
           last_seen_at = null,
           updated_at = p_now
     where id = p_worker_id
     returning *
      into v_worker;
  end if;

  v_ignored := public.requeue_worker_active_issues(p_worker_id, p_now);

  return v_worker;
end;
$$;

create or replace function public.unban_worker(
  p_user_id text,
  p_worker_id uuid,
  p_now timestamptz default now()
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
begin
  update public.workers
     set banned_at = null,
         last_seen_at = null,
         updated_at = p_now
   where id = p_worker_id
     and user_id = p_user_id
   returning *
    into v_worker;

  if not found then
    return null;
  end if;

  return v_worker;
end;
$$;

create or replace function public.delete_worker(
  p_user_id text,
  p_worker_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_ignored integer;
begin
  select *
    into v_worker
    from public.workers
   where id = p_worker_id
     and user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;

  if v_worker.banned_at is null then
    update public.workers
       set banned_at = p_now,
           last_seen_at = null,
           credential_expires_at = greatest(
             p_now,
             v_worker.created_at + interval '1 microsecond'
           ),
           updated_at = p_now
     where id = p_worker_id;
  end if;

  v_ignored := public.requeue_worker_active_issues(p_worker_id, p_now);

  delete from public.workers
   where id = p_worker_id
     and user_id = p_user_id;

  return true;
end;
$$;

revoke execute on function public.requeue_worker_active_issues(uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.rename_worker(text, uuid, text, timestamptz)
  from public, authenticated;
revoke execute on function public.ban_worker(text, uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.unban_worker(text, uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.delete_worker(text, uuid, timestamptz)
  from public, authenticated;

grant execute on function public.rename_worker(text, uuid, text, timestamptz)
  to service_role;
grant execute on function public.ban_worker(text, uuid, timestamptz)
  to service_role;
grant execute on function public.unban_worker(text, uuid, timestamptz)
  to service_role;
grant execute on function public.delete_worker(text, uuid, timestamptz)
  to service_role;
