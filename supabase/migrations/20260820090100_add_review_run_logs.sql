-- The Review Run log sink (GEN-415): execution logs from the isolated
-- reviewer agent process stream here, deliberately separate from Issue chat
-- (`chat_messages`/the issue realtime topic). Append-only and text-only —
-- unlike Issue chat there is no tool-call/event-type machinery, since
-- user-facing timeline rendering for review runs remains out of scope (see
-- ADR-0005's "Consequences").

create table public.review_run_logs (
  id uuid primary key default gen_random_uuid(),
  review_run_id uuid not null
    references public.review_runs(id) on delete cascade,
  seq integer not null,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint review_run_logs_role_valid check (role in ('assistant', 'system')),
  constraint review_run_logs_seq_positive check (seq > 0),
  constraint review_run_logs_review_run_seq_unique unique (review_run_id, seq)
);

create index review_run_logs_review_run_id_idx
  on public.review_run_logs(review_run_id);

alter table public.review_run_logs enable row level security;

grant select on public.review_run_logs to authenticated;
grant select, insert on public.review_run_logs to service_role;

create policy "Users can read review run logs for their own issues"
  on public.review_run_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.review_runs
      join public.review_cycles on review_cycles.id = review_runs.review_cycle_id
      join public.issues on issues.id = review_cycles.issue_id
      join public.projects on projects.id = issues.project_id
      where review_runs.id = review_run_logs.review_run_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

alter table public.review_run_logs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_run_logs'
  ) then
    alter publication supabase_realtime add table public.review_run_logs;
  end if;
end $$;

-- Realtime Broadcast authorization for the private `review-run:{id}` channel
-- (mirrors `20260713120000_realtime_broadcast_issue_messages.sql`'s
-- `issue:{id}` policies, deliberately kept as a separate channel from Issue
-- chat). The same worker-minted, user-scoped JWT that already authorizes an
-- `issue:{id}` join authorizes a `review-run:{id}` join too — only the RLS
-- ownership check differs, walking review_runs -> review_cycles -> issues ->
-- projects instead of issues -> projects directly.
create policy "review run owner can receive broadcasts"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.review_runs rr
    join public.review_cycles rc on rc.id = rr.review_cycle_id
    join public.issues i on i.id = rc.issue_id
    join public.projects p on p.id = i.project_id
    where (select realtime.topic()) = 'review-run:' || rr.id::text
      and p.user_id = ((select auth.jwt()) ->> 'sub')
  )
);

create policy "review run owner can send broadcasts"
on "realtime"."messages"
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.review_runs rr
    join public.review_cycles rc on rc.id = rr.review_cycle_id
    join public.issues i on i.id = rc.issue_id
    join public.projects p on p.id = i.project_id
    where (select realtime.topic()) = 'review-run:' || rr.id::text
      and p.user_id = ((select auth.jwt()) ->> 'sub')
  )
);
