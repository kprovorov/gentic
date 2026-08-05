-- Archives a Label atomically: marks it archived, removes every assignment
-- (any count, including zero), and records one grouped `labels_changed`
-- removal event per affected issue. All three effects happen inside this
-- single function call, so a failure partway through leaves no state
-- changed. There is no restore path in this ticket (GEN-303) — archival is
-- one-directional, matching the "no restore action" scope decision.
--
-- SECURITY DEFINER + an explicit p_user_id ownership check, granted to
-- service_role only, mirrors the worker lifecycle RPCs
-- (`ban_worker`/`delete_worker` in 20260729200000_worker_lifecycle_management.sql)
-- rather than relying on per-statement RLS, since this needs one atomic
-- transaction across `labels`, `issue_labels`, and `issue_events`.
create or replace function public.archive_label(
  p_user_id text,
  p_label_id uuid,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  affected_issue_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label public.labels%rowtype;
  v_affected_count integer := 0;
begin
  select *
    into v_label
    from public.labels
   where labels.id = p_label_id
     and labels.user_id = p_user_id
     and labels.state = 'active'
   for update;

  if not found then
    return;
  end if;

  with removed as (
    delete from public.issue_labels
     where issue_labels.label_id = p_label_id
    returning issue_labels.issue_id
  ),
  inserted_events as (
    insert into public.issue_events (issue_id, type, payload)
    select removed.issue_id,
           'labels_changed',
           jsonb_build_object(
             'added', '[]'::jsonb,
             'removed', jsonb_build_array(
               jsonb_build_object(
                 'id', v_label.id,
                 'name', v_label.name,
                 'color', v_label.color
               )
             )
           )
      from removed
    returning issue_id
  )
  select count(*)::integer
    into v_affected_count
    from removed;

  update public.labels
     set state = 'archived',
         archived_at = p_now,
         updated_at = p_now
   where labels.id = p_label_id;

  return query select v_label.id, v_affected_count;
end;
$$;

revoke execute on function public.archive_label(text, uuid, timestamptz)
  from public, authenticated;

grant execute on function public.archive_label(text, uuid, timestamptz)
  to service_role;
