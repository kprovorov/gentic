-- Automatic Review for pull requests no Issue produced (GEN-432, see
-- ADR-0010). Every part of the review lifecycle — the frozen policy
-- (`issue_review_policies`), cycles, runs, worker claiming, publishing, the
-- timeline — hangs off an Issue. Rather than teach each of those to work
-- without one, a pull request that arrives with no Issue behind it gets a
-- *tracking Issue*: an ordinary `issues` row the webhook creates so the
-- existing engine has something to hang the review on.
--
-- Trusted, service-role-only orchestration, like every other webhook-driven
-- function here: the caller has already resolved the GitHub installation to
-- its owner and the base repository to this Project.

-- How an Issue came to exist. Everything a user or the MCP tools create is
-- `user`; `external_pull_request` marks a tracking Issue. The distinction is
-- load-bearing, not cosmetic: the three paths that hand pull request feedback
-- back to an agent (`applyChangesRequestedReview`, `applyPullRequestComment`,
-- `applyTestsFailed`) re-queue the Issue to `todo`, and doing that to a
-- tracking Issue would start an agent run against a pull request that is not
-- its to fix.
alter table public.issues
  add column source text not null default 'user',
  add constraint issues_source_valid check (
    source in ('user', 'external_pull_request')
  );

create or replace function public.track_external_pull_request(
  p_project_id uuid,
  p_pr_url text,
  p_pr_state text,
  p_ready_for_review boolean,
  p_title text,
  p_body text,
  p_head_sha text default null
)
returns table (
  association_created boolean,
  associated_issue_id uuid,
  issue_status_changed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_issue_id uuid;
  v_automatic_review_enabled boolean;
  v_number integer;
begin
  -- Two deliveries for the same new pull request (`opened`, and the
  -- `synchronize` right behind it) would otherwise both find no association
  -- and both create a tracking Issue. Only one could then win the unique
  -- `issue_pull_requests.url`, leaving the loser's Issue behind with no
  -- pull request at all.
  perform pg_advisory_xact_lock(
    hashtext('track_external_pull_request:' || p_pr_url)
  );

  select issue_id
    into v_issue_id
    from public.issue_pull_requests
   where url = p_pr_url;

  if v_issue_id is null then
    -- Re-read rather than trusted from the caller: this is the same setting
    -- `snapshot_issue_review_policy` freezes a moment from now, on the
    -- `issue_pull_requests` insert below. Creating an Issue whose frozen
    -- policy says review is disabled would leave permanent noise in the
    -- tracker for a review that can never run.
    select automatic_review_enabled
      into v_automatic_review_enabled
      from public.projects
     where id = p_project_id;

    if not coalesce(v_automatic_review_enabled, false) then
      return;
    end if;

    v_number := public.next_issue_number_for_project(p_project_id);

    -- `create_pr_automatically` is false because the pull request this Issue
    -- tracks already exists; there is nothing for an agent to publish.
    insert into public.issues (
      project_id,
      number,
      title,
      body,
      status,
      type,
      source,
      create_pr_automatically
    ) values (
      p_project_id,
      v_number,
      p_title,
      p_body,
      'ready-for-review',
      'issue',
      'external_pull_request',
      false
    )
    returning id into v_issue_id;
  end if;

  return query
    select *
      from public.associate_pull_request_from_webhook(
        v_issue_id,
        p_pr_url,
        p_pr_state,
        p_ready_for_review,
        p_head_sha
      );
end;
$$;

revoke all on function public.track_external_pull_request(
  uuid, text, text, boolean, text, text, text
) from public, anon, authenticated;

grant execute on function public.track_external_pull_request(
  uuid, text, text, boolean, text, text, text
) to service_role;
