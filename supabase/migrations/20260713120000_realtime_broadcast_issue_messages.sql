-- Realtime Broadcast authorization for the private `issue:{id}` channel the
-- browser and the `@gentic/gentic` worker join to stream the live agent
-- conversation (see docs/realtime-transport.md). Reuses the same
-- issues -> projects.user_id ownership join RLS already uses elsewhere;
-- `issues` has no `user_id` of its own.
create policy "issue owner can receive broadcasts"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.issues i
    join public.projects p on p.id = i.project_id
    where (select realtime.topic()) = 'issue:' || i.id::text
      and p.user_id = ((select auth.jwt()) ->> 'sub')
  )
);

create policy "issue owner can send broadcasts"
on "realtime"."messages"
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.issues i
    join public.projects p on p.id = i.project_id
    where (select realtime.topic()) = 'issue:' || i.id::text
      and p.user_id = ((select auth.jwt()) ->> 'sub')
  )
);
