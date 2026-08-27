-- GEN-428: an Issue the automatic reviewer had just approved fell back to
-- `ready-for-review` seconds later.
--
-- `complete_review_attempt` sets the Issue to `approved` on an approving
-- verdict, and `publishReviewVerdict` posts that verdict to GitHub as a real
-- APPROVE review. GitHub then echoes that review back as a
-- `pull_request_review` delivery, whose handler re-hydrates the PR snapshot
-- and re-runs this aggregator — which promptly undid the approval.
--
-- The cause is that GitHub's `reviewDecision` is a *branch-protection*
-- field, not an "is this approved" field: it is null for any repository
-- that does not require reviews, however many approving reviews the PR
-- carries. `resolvePullRequestSnapshot` maps that null to `unknown`, so
-- ADR-0004's design — automatic-cycle approval as an *additional* condition
-- layered on top of `review_decision = 'approved'` — could never be
-- satisfied on such a repository, and the aggregator fell through to
-- `ready-for-review`.
--
-- So the automatic verdict now *replaces* GitHub's decision as the approval
-- source rather than supplementing it: when Automatic Review is enabled for
-- the Issue, every reviewable PR's latest review cycle being `approved` is
-- both necessary and sufficient. Automatic Review is precisely the gate the
-- account owner opted into, and the stronger branches above still win — a
-- human `changes_requested` review, failing CI, or pending CI all outrank an
-- automatic approval, unchanged. Issues without Automatic Review keep their
-- exact prior GitHub-decision behavior.
create or replace function public.recompute_issue_status_from_pull_requests(
  p_issue_id uuid
)
returns table (
  issue_id uuid,
  previous_status text,
  next_status text,
  status_changed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_active_run_id uuid;
  v_previous_status text;
  v_next_status text;
  v_reviewable_count integer;
  v_participating_count integer;
  v_unknown_count integer;
  v_merged_count integer;
  v_automatic_review_enabled boolean;
  v_approved boolean;
begin
  select active_run_id, status
    into v_active_run_id, v_previous_status
    from public.issues
   where id = p_issue_id
   for update;

  if not found then
    raise exception 'Issue not found: %', p_issue_id;
  end if;

  -- Webhooks may persist PR state during a run, but must not revoke its lease
  -- by moving the Issue out of queued/in-progress. Completed and cancelled are
  -- explicit terminal decisions and are likewise protected.
  if v_active_run_id is not null
     or v_previous_status in ('completed', 'cancelled') then
    return query select p_issue_id, v_previous_status, v_previous_status, false;
    return;
  end if;

  select irp.enabled
    into v_automatic_review_enabled
    from public.issue_review_policies irp
   where irp.issue_id = p_issue_id;

  select
    count(*) filter (where state in ('open', 'queued')),
    count(*) filter (where state in ('open', 'queued', 'merged', 'closed')),
    count(*) filter (where state = 'unknown'),
    count(*) filter (where state = 'merged')
    into
      v_reviewable_count,
      v_participating_count,
      v_unknown_count,
      v_merged_count
    from public.issue_pull_requests as ipr
   where ipr.issue_id = p_issue_id;

  if v_reviewable_count > 0 then
    if exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.review_decision = 'changes_requested'
    ) then
      v_next_status := 'changes-requested';
    elsif exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.ci_state = 'failure'
    ) then
      v_next_status := 'tests-failed';
    elsif exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.ci_state = 'pending'
    ) then
      v_next_status := 'testing';
    else
      if coalesce(v_automatic_review_enabled, false) then
        -- The PR's *latest* cycle must be the one that approved, not merely
        -- some cycle in its history — otherwise a post-approval push that
        -- opened a fresh (not yet approved) cycle would be masked by the
        -- earlier approval.
        v_approved := not exists (
          select 1 from public.issue_pull_requests as ipr
           where ipr.issue_id = p_issue_id
             and ipr.state in ('open', 'queued')
             and coalesce(
               (
                 select rc.state = 'approved'
                   from public.review_cycles as rc
                  where rc.pull_request_id = ipr.id
                  order by rc.created_at desc
                  limit 1
               ),
               false
             ) = false
        );
      else
        v_approved := not exists (
          select 1 from public.issue_pull_requests as ipr
           where ipr.issue_id = p_issue_id
             and ipr.state in ('open', 'queued')
             and ipr.review_decision <> 'approved'
        );
      end if;

      if v_approved then
        v_next_status := 'approved';
      elsif coalesce(v_automatic_review_enabled, false) and exists (
        select 1
          from public.issue_pull_requests as ipr
          join public.review_cycles as rc
            on rc.pull_request_id = ipr.id and rc.state = 'active'
          join public.review_runs as rr
            on rr.review_cycle_id = rc.id and rr.status in ('pending', 'running')
         where ipr.issue_id = p_issue_id
           and ipr.state in ('open', 'queued')
      ) then
        v_next_status := 'reviewing';
      else
        v_next_status := 'ready-for-review';
      end if;
    end if;
  elsif v_participating_count > 0
        and v_unknown_count = 0 then
    if v_merged_count > 0 then
      v_next_status := 'merged';
    else
      v_next_status := 'cancelled';
    end if;
  else
    -- Draft and unknown PRs are visible but contribute no workflow state.
    v_next_status := v_previous_status;
  end if;

  if v_next_status is distinct from v_previous_status then
    update public.issues
       set status = v_next_status,
           updated_at = now()
     where id = p_issue_id;

    insert into public.issue_events (issue_id, type, payload)
    values (
      p_issue_id,
      'status_changed',
      jsonb_build_object('from', v_previous_status, 'to', v_next_status)
    );

    return query select p_issue_id, v_previous_status, v_next_status, true;
  else
    return query select p_issue_id, v_previous_status, v_next_status, false;
  end if;
end;
$$;
