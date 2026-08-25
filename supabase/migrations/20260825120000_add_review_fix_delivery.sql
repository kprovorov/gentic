-- Returns automatic review findings to the original implementation session
-- (GEN-417, see ADR-0007). Everything here is trusted, service-role-only
-- orchestration: it turns a recorded `changes_requested` Review Attempt into
-- a fix-turn on the same Issue conversation the owning agent session
-- resumes from — reusing the durable ownership this rests on (GEN-412,
-- `issue_implementation_owners`) and the existing "insert a gentic-authored
-- user message, requeue to todo" pattern already used for a genuine human
-- changes-requested review (`applyChangesRequestedReview` in
-- `packages/services/src/issues/chat.ts`).

-- Mirrors the `github_review_id`/`github_comment_id` idempotency columns
-- already on `messages`: this is the delivery's dedupe key, so replaying the
-- same Review Attempt (e.g. a retried webhook, or the `complete` route being
-- called twice for the same run) never queues a second fix-turn.
alter table public.messages
  add column review_attempt_id uuid references public.review_attempts(id) on delete set null;

create unique index messages_issue_id_review_attempt_id_idx
  on public.messages(issue_id, review_attempt_id)
  where review_attempt_id is not null;

-- Delivers one Review Attempt's findings to the Issue's current durable
-- implementation owner, or explains why it did not. Idempotent (a second
-- call for the same attempt reports `already_delivered` rather than
-- inserting a second message) and safe to call from a webhook retry.
--
-- Every rejection reason is a stop condition, not an error: the Issue is
-- left exactly as `complete_review_attempt` left it (still
-- `changes-requested`), so a human can act (a fresh implementation, manual
-- intervention, or simply waiting for the next push) rather than the
-- automatic loop silently doing something else instead.
create or replace function public.deliver_review_fix_request(
  p_review_attempt_id uuid,
  p_content text,
  p_now timestamptz default now()
)
returns table (
  review_attempt_id uuid,
  issue_id uuid,
  outcome text,
  unavailable_reason text
)
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.review_attempts%rowtype;
  v_issue_id uuid;
  v_cycle public.review_cycles%rowtype;
  v_pr public.issue_pull_requests%rowtype;
  v_issue public.issues%rowtype;
  v_owner public.issue_implementation_owners%rowtype;
  v_owner_found boolean;
  v_worker_banned boolean;
  v_message_id uuid;
begin
  select * into v_attempt
    from public.review_attempts
   where id = p_review_attempt_id;

  if not found then
    return query select p_review_attempt_id, null::uuid, 'not_found', null::text;
    return;
  end if;

  if v_attempt.verdict <> 'changes_requested' then
    return query select p_review_attempt_id, null::uuid, 'not_changes_requested', null::text;
    return;
  end if;

  -- Lock the Issue before the cycle, the same order every other
  -- review-lifecycle function uses, so this can never deadlock against
  -- `evaluate_review_eligibility` / `supersede_active_review_cycle` racing
  -- on the same pull request (e.g. a genuine human changes-requested review
  -- landing at the same moment).
  select review_cycles.issue_id into v_issue_id
    from public.review_cycles
   where id = v_attempt.review_cycle_id;

  perform 1 from public.issues where id = v_issue_id for update;

  select * into v_cycle
    from public.review_cycles
   where id = v_attempt.review_cycle_id
   for update;

  select * into v_issue from public.issues where id = v_issue_id;
  select * into v_pr from public.issue_pull_requests where id = v_cycle.pull_request_id;

  if exists (
    select 1 from public.messages
     where messages.issue_id = v_issue_id
       and messages.review_attempt_id = p_review_attempt_id
  ) then
    return query select p_review_attempt_id, v_issue_id, 'already_delivered', null::text;
    return;
  end if;

  -- Not active means either exhausted (third changes-requested attempt —
  -- automatic looping stops and requires human action) or superseded (a new
  -- push, or a genuine human review, already took over this cycle).
  if v_cycle.state <> 'active' then
    return query select p_review_attempt_id, v_issue_id, 'cycle_not_active', null::text;
    return;
  end if;

  -- The pull request moved past the exact commit these findings were
  -- produced against — a push landed between this Review Attempt completing
  -- and delivery. Stale findings are never applied to a newer head.
  if v_pr.head_sha is distinct from v_cycle.head_sha then
    return query select p_review_attempt_id, v_issue_id, 'stale_head', null::text;
    return;
  end if;

  select * into v_owner
    from public.issue_implementation_owners
   where issue_implementation_owners.issue_id = v_issue_id
     and superseded_at is null;
  v_owner_found := found;

  if not v_owner_found then
    return query select p_review_attempt_id, v_issue_id, 'no_owner', null::text;
    return;
  end if;

  -- Mirrors `deriveAvailability` in
  -- `packages/services/src/issues/implementation-owner.ts` — kept in sync
  -- deliberately, since both derive resumability from the same live
  -- worker/issue state rather than a stored flag.
  if v_owner.agent_provider <> v_issue.agent_provider
     or coalesce(v_owner.issue_model, '') <> coalesce(v_issue.issue_model, '') then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'provider_changed';
    return;
  end if;

  if v_owner.session_id is null then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'session_missing';
    return;
  end if;

  if v_owner.worker_id is null then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'worker_deleted';
    return;
  end if;

  select (banned_at is not null) into v_worker_banned
    from public.workers
   where id = v_owner.worker_id;

  if coalesce(v_worker_banned, false) then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'worker_banned';
    return;
  end if;

  insert into public.messages (issue_id, role, author_type, content, review_attempt_id)
  values (v_issue_id, 'user', 'gentic', p_content, p_review_attempt_id)
  returning id into v_message_id;

  update public.issues
     set status = 'todo',
         usage_limit_reset_at = null,
         updated_at = p_now
   where id = v_issue_id
     and status = 'changes-requested';

  insert into public.issue_events (issue_id, type, payload)
  values (
    v_issue_id,
    'review_fix_delivered',
    jsonb_build_object(
      'review_attempt_id', p_review_attempt_id,
      'message_id', v_message_id
    )
  );

  return query select p_review_attempt_id, v_issue_id, 'delivered', null::text;
end;
$$;

revoke all on function public.deliver_review_fix_request(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.deliver_review_fix_request(uuid, text, timestamptz)
  to service_role;
