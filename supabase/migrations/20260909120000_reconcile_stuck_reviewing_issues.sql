-- GEN-449: issues sat in `reviewing` indefinitely after their Review Cycle
-- stopped progressing. `issues.status = 'reviewing'` is written exactly once,
-- as a side effect of queueing a run (`evaluate_review_eligibility` ->
-- `set_issue_status_from_review`), and every way a cycle can stop short
-- afterwards leaves that write stale with no compensating update:
--
--   * two infrastructure failures at the same commit spend
--     `fail_review_run`'s retry budget and deliberately leave the cycle
--     `active` with no live run (docs/web/automatic-review.mdx);
--   * a verdict landing against a cancelled/superseded run, a non-active
--     cycle, or a fourth attempt returns `accepted = false` from
--     `complete_review_attempt`, which records nothing;
--   * an approving verdict held back by the sibling-pull-request gate
--     (GEN-430) intentionally forces no Issue status at all;
--   * `evaluate_review_eligibility` cancels the live run the moment the pull
--     request stops being eligible (CI went non-green, the pull request was
--     closed or converted back to draft), leaving the cycle `active` with
--     nothing queued behind it.
--
-- None of these raise, and none are followed by another status write, so the
-- Issue keeps advertising "a reviewer is looking at this" forever -- even
-- when the reviewer already approved it. Patching each path individually
-- would be a losing game: the list is open-ended, and the silence of those
-- guards is exactly what makes them safe to call from anywhere. So reconcile
-- the invariant instead. An Issue in `reviewing` with no running review run
-- and no *claimable* pending one is, by definition, not being reviewed;
-- re-derive its status from the pull requests via
-- `recompute_issue_status_from_pull_requests` -- the same aggregator the
-- GitHub webhook already trusts. A silently-approved cycle converges to
-- `approved`; a genuinely dead-ended one converges to `ready-for-review`,
-- where the Retry review control is offered.
--
-- This never fights the happy path: the aggregator itself reports
-- `reviewing` precisely when a live run exists, which is the same condition
-- that keeps a row out of this function's selection.

-- Supports the reconciler's sweep; almost always empty, which is the point.
create index if not exists issues_stuck_reviewing_idx
  on public.issues (updated_at)
  where status = 'reviewing' and active_run_id is null;

create or replace function public.reconcile_stuck_reviewing_issues(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_issue record;
  v_status_changed boolean;
  v_reconciled_count integer := 0;
begin
  for v_issue in
    select i.id
      from public.issues i
     where i.status = 'reviewing'
       -- An implementation run owns the Issue's status while it holds the
       -- lease; `recompute_issue_status_from_pull_requests` would refuse to
       -- act anyway, and `finish_issue_run_if_no_pending` re-derives the
       -- status when that run ends.
       and i.active_run_id is null
       -- Grace window, so this is a safety net and never a participant: a
       -- transition still settling (a run mid-claim, a verdict mid-publish)
       -- is left alone. Anything genuinely stuck stays stuck far longer.
       and i.updated_at <= p_now - interval '2 minutes'
       -- Only reconcile a status the review engine itself produced. Nothing
       -- stops a user from parking an issue in `reviewing` by hand (it is an
       -- ordinary selectable status), and an issue Automatic Review has
       -- never touched is not this function's to re-derive.
       and exists (
         select 1
           from public.review_cycles rc
          where rc.issue_id = i.id
       )
       and not exists (
         select 1
           from public.review_runs rr
           join public.review_cycles rc on rc.id = rr.review_cycle_id
          where rc.issue_id = i.id
            and (
              rr.status = 'running'
              -- A pending run only counts as live if `claim_review_run`
              -- could actually pick it up. One stranded behind a concluded
              -- cycle or a pull request that is no longer reviewable never
              -- will be, and must not hold the Issue in `reviewing`.
              or (
                rr.status = 'pending'
                and rc.state = 'active'
                and exists (
                  select 1
                    from public.issue_pull_requests ipr
                   where ipr.id = rc.pull_request_id
                     and ipr.state in ('open', 'queued')
                )
              )
            )
       )
     for update of i skip locked
  loop
    select r.status_changed
      into v_status_changed
      from public.recompute_issue_status_from_pull_requests(v_issue.id) r;

    if v_status_changed then
      v_reconciled_count := v_reconciled_count + 1;
    end if;
  end loop;

  return v_reconciled_count;
end;
$$;

revoke all on function public.reconcile_stuck_reviewing_issues(timestamptz)
  from public;

-- A minute is ample for an invariant that only breaks when a cycle has
-- already stopped moving, and the 2-minute grace above means a tighter
-- schedule would buy nothing. A stable name keeps this migration replayable:
-- Supabase Cron upserts an existing job with the same case-sensitive name.
select cron.schedule(
  'reconcile-stuck-reviewing-issues',
  '1 minute',
  $job$select public.reconcile_stuck_reviewing_issues();$job$
);
