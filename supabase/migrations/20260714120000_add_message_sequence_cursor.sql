alter table public.issues
  add column run_id uuid,
  add column message_cursor_seq bigint not null default 0;

alter table public.messages
  add column seq bigint,
  add column run_id uuid;

create sequence public.messages_seq_seq as bigint;

with ordered_messages as (
  select
    id,
    row_number() over (order by created_at, id) as seq
  from public.messages
)
update public.messages
set seq = ordered_messages.seq
from ordered_messages
where public.messages.id = ordered_messages.id;

select setval(
  'public.messages_seq_seq',
  coalesce((select max(seq) from public.messages), 1),
  exists(select 1 from public.messages)
);

alter table public.messages
  alter column seq set default nextval('public.messages_seq_seq'),
  alter column seq set not null;

alter sequence public.messages_seq_seq owned by public.messages.seq;

grant usage, select on sequence public.messages_seq_seq to authenticated;

create unique index messages_seq_idx on public.messages(seq);
create index messages_issue_id_seq_idx on public.messages(issue_id, seq);

update public.issues
set message_cursor_seq = coalesce(
  (
    select max(messages.seq)
    from public.messages
    where messages.issue_id = issues.id
      and messages.role = 'user'
      and messages.created_at <= issues.run_finished_at
  ),
  0
)
where issues.session_id is not null
  and issues.run_finished_at is not null;
