-- Implementation-session ownership for review fixes (GEN-412).
--
-- The run lease (`issues.active_run_id` + `active_worker_id`) is transient: it
-- is released the moment a run ends (see `release_issue_run_lease`), and any
-- eligible worker can claim a re-queued issue. That is fine for picking up new
-- work, but review fixes must go back to the *same* agent session that produced
-- the pull-request changes — the one whose local checkout and resumable ACP
-- session can address the feedback. Nothing durable recorded who that was.
--
-- `issue_implementation_owners` is that durable, addressable identity. One
-- current (non-superseded) row per issue records the owning worker, the ACP
-- session handle to resume, and the agent provider/model the session runs. It
-- survives lease release, worker reconnects, service restarts, lease expiry,
-- and review retries — it is only replaced by an explicit, user-initiated
-- `start_fresh_implementation`.
--
-- Whether an owner is *resumable* (and, if not, why) is derived at read time
-- from the live worker + issue rows rather than stored, so ban/delete/offline
-- and provider changes never need to fan out writes here to stay correct. The
-- reason codes live in `@gentic/services/issues` (`implementation-owner.ts`).

create table public.issue_implementation_owners (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  -- Monotonic per issue. Bumped by every fresh-implementation and every reset,
  -- so a stale handoff that names an old generation can be rejected and the
  -- audit trail of ownership hand-offs is stable.
  generation integer not null,
  origin text not null check (origin in ('implementation', 'fresh_implementation')),
  -- The durable machine identity. A worker id is stable across reconnects and
  -- restarts, unlike the run lease. Null once that worker is deleted (the FK
  -- nulls it) or while a fresh-implementation owner waits for its first run.
  worker_id uuid references public.workers(id) on delete set null,
  -- The ACP session handle to resume. Refreshed each time the owning worker
  -- persists a new resume handle; null until the owner's first run brings one.
  session_id text,
  agent_provider text not null,
  issue_model text,
  established_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issue_implementation_owners_generation_positive
    check (generation >= 1),
  constraint issue_implementation_owners_session_not_blank
    check (session_id is null or length(btrim(session_id)) > 0)
);

-- At most one current owner per issue. `start_fresh_implementation` and the
-- session-clear path supersede the previous owner before a new one appears, so
-- concurrent recovery attempts resolve to a single owner.
create unique index issue_implementation_owners_current_unique
  on public.issue_implementation_owners(issue_id)
  where superseded_at is null;

-- Generations are unique per issue for a stable audit trail.
create unique index issue_implementation_owners_generation_unique
  on public.issue_implementation_owners(issue_id, generation);

create index issue_implementation_owners_worker_id_idx
  on public.issue_implementation_owners(worker_id)
  where worker_id is not null;

-- Keeps the current owner in sync with the run lease as it moves through the
-- issue's life. Runs `security definer` so it can maintain ownership regardless
-- of which client (service-role worker writes, or an authenticated user's
-- reset/provider change) drove the underlying issue update.
create or replace function public.sync_issue_implementation_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.issue_implementation_owners%rowtype;
  v_next_generation integer;
begin
  -- Session cleared: the resumable owner is gone. `reset_issue_run` and an
  -- agent-provider change both null out `session_id`, so treat that as the end
  -- of the current ownership and supersede it — the next implementation run
  -- then establishes a fresh generation. A fresh-implementation owner that is
  -- still waiting for its first run carries a null session and must not be torn
  -- down here, so only owners that actually hold a session are superseded.
  if new.session_id is null then
    if tg_op = 'UPDATE' and old.session_id is not null then
      update public.issue_implementation_owners
         set superseded_at = now(),
             updated_at = now()
       where issue_id = new.id
         and superseded_at is null
         and session_id is not null;
    end if;
    return new;
  end if;

  -- With a session present, only a live run (lease held) can own the work.
  if new.active_run_id is null or new.active_worker_id is null then
    return new;
  end if;

  -- Nothing ownership-relevant changed.
  if tg_op = 'UPDATE'
     and new.session_id is not distinct from old.session_id
     and new.active_worker_id is not distinct from old.active_worker_id
     and new.agent_provider is not distinct from old.agent_provider
     and new.issue_model is not distinct from old.issue_model then
    return new;
  end if;

  select *
    into v_current
    from public.issue_implementation_owners
   where issue_id = new.id
     and superseded_at is null
   for update;

  if not found then
    select coalesce(max(generation), 0) + 1
      into v_next_generation
      from public.issue_implementation_owners
     where issue_id = new.id;

    insert into public.issue_implementation_owners (
      issue_id, generation, origin, worker_id, session_id,
      agent_provider, issue_model
    ) values (
      new.id, v_next_generation, 'implementation', new.active_worker_id,
      new.session_id, new.agent_provider, new.issue_model
    );
    return new;
  end if;

  -- Bind an unbound (fresh-implementation) owner to the first run that brings a
  -- session, and let the owning worker refresh its resume handle on reconnect,
  -- restart or a review retry. A *different* worker never takes ownership
  -- implicitly — worker reassignment must go through start_fresh_implementation.
  if v_current.worker_id is null
     or v_current.worker_id = new.active_worker_id then
    update public.issue_implementation_owners
       set worker_id = new.active_worker_id,
           session_id = new.session_id,
           agent_provider = new.agent_provider,
           issue_model = new.issue_model,
           updated_at = now()
     where id = v_current.id;
  end if;

  return new;
end;
$$;

create trigger issues_sync_implementation_owner
  after insert or update of
    session_id, active_run_id, active_worker_id, agent_provider, issue_model
  on public.issues
  for each row
  execute function public.sync_issue_implementation_owner();

-- The explicit "fresh implementation" transition. It requires a user action
-- (the caller passes the authenticated Clerk user, checked against the issue's
-- project owner), establishes a brand-new owner generation, and stops any
-- in-flight run so the old owner cannot resume and re-bind the fresh owner.
--
-- All of it happens under `for update` on the issue row, so a late resume of
-- the old owner and this action cannot both win: whichever commits first is the
-- single outcome, and the loser's run-state writes (gated on the run lease this
-- clears) are rejected.
create or replace function public.start_fresh_implementation(
  p_user_id text,
  p_issue_id uuid,
  p_now timestamptz default now()
)
returns public.issue_implementation_owners
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.issues%rowtype;
  v_next_generation integer;
  v_owner public.issue_implementation_owners%rowtype;
begin
  select i.*
    into v_issue
    from public.issues i
    join public.projects p on p.id = i.project_id
   where i.id = p_issue_id
     and p.user_id = p_user_id
   for update of i;

  if not found then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;

  if v_issue.type = 'spec' then
    raise exception 'Spec issues do not run a coding agent'
      using errcode = '22023';
  end if;

  -- Supersede whatever owner is current (bound or still waiting) before the new
  -- generation appears, so the single-current-owner index is never violated and
  -- there is never a window with two current owners.
  update public.issue_implementation_owners
     set superseded_at = p_now,
         updated_at = p_now
   where issue_id = p_issue_id
     and superseded_at is null;

  select coalesce(max(generation), 0) + 1
    into v_next_generation
    from public.issue_implementation_owners
   where issue_id = p_issue_id;

  insert into public.issue_implementation_owners (
    issue_id, generation, origin, worker_id, session_id,
    agent_provider, issue_model, established_at
  ) values (
    p_issue_id, v_next_generation, 'fresh_implementation', null, null,
    v_issue.agent_provider, v_issue.issue_model, p_now
  )
  returning * into v_owner;

  -- Clear the resume handle and the run lease and re-queue the issue. This is
  -- what makes the transition race-free: any surviving run is invalidated (its
  -- writes are gated on `active_run_id`/`active_worker_id`), and the next run
  -- starts a brand-new session that binds this fresh owner. The trigger above
  -- leaves this owner alone because it has no session yet.
  update public.issues
     set status = 'todo',
         session_id = null,
         active_run_id = null,
         active_worker_id = null,
         run_error = null,
         run_started_at = null,
         run_finished_at = null,
         usage_limit_reset_at = null,
         updated_at = p_now
   where id = p_issue_id;

  insert into public.issue_events (issue_id, type, payload)
  values (
    p_issue_id,
    'implementation_ownership_reset',
    jsonb_build_object(
      'generation', v_next_generation,
      'origin', 'fresh_implementation'
    )
  );

  return v_owner;
end;
$$;

revoke all on function public.start_fresh_implementation(text, uuid, timestamptz)
  from public;
grant execute on function public.start_fresh_implementation(text, uuid, timestamptz)
  to authenticated;
grant execute on function public.start_fresh_implementation(text, uuid, timestamptz)
  to service_role;

grant select on public.issue_implementation_owners to authenticated;

alter table public.issue_implementation_owners enable row level security;

-- User ids are Clerk subjects, read out of the verified JWT via
-- auth.jwt()->>'sub' rather than auth.uid(). The trigger and RPC above run
-- `security definer`, so they maintain rows regardless of this policy.
create policy "Users can read implementation owners for their own issues"
  on public.issue_implementation_owners
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_implementation_owners.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

-- Realtime: stream ownership changes to the browser like issue events, so the
-- (out-of-scope here) recovery controls can react without polling.
alter table public.issue_implementation_owners replica identity full;
alter publication supabase_realtime add table public.issue_implementation_owners;
