alter table public.messages
  add column event_id text,
  add column run_id text,
  add column event_type text,
  add column event_status text,
  add column event_ts timestamptz,
  add column event_seq integer,
  add column tool_call_id text,
  add column payload jsonb;

alter table public.messages
  drop constraint messages_kind_valid,
  drop constraint messages_status_valid;

alter table public.messages
  add constraint messages_kind_valid check (
    kind in ('text', 'tool', 'thinking', 'plan', 'mode', 'commands')
  ),
  add constraint messages_status_valid check (
    status in ('streaming', 'complete', 'error')
  ),
  add constraint messages_event_type_valid check (
    event_type is null
    or event_type in (
      'text',
      'thought',
      'tool_call',
      'plan',
      'mode',
      'available_commands'
    )
  ),
  add constraint messages_event_status_valid check (
    event_status is null
    or event_status in (
      'pending',
      'in_progress',
      'completed',
      'failed',
      'removed'
    )
  ),
  add constraint messages_event_seq_positive check (
    event_seq is null or event_seq > 0
  );

create index messages_issue_run_idx
  on public.messages(issue_id, run_id)
  where run_id is not null;

create index messages_issue_event_id_idx
  on public.messages(issue_id, event_id)
  where event_id is not null;

update public.messages
set
  event_id = id::text,
  event_type = case
    when kind = 'thinking' then 'thought'
    when kind = 'tool' then 'tool_call'
    else 'text'
  end,
  event_status = case
    when status = 'streaming' then 'in_progress'
    when status = 'error' then 'failed'
    else 'completed'
  end,
  event_ts = created_at,
  event_seq = 1,
  payload = jsonb_build_object(
    'legacy', true,
    'content', coalesce(content, '')
  )
where event_id is null;
