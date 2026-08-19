-- Automatic Review lifecycle engine (GEN-413 / ADR-0004): eligibility,
-- attempt budgeting across pushes, infra-failure retry, supersession, and
-- the gate that keeps a bare human GitHub approval from auto-approving.
BEGIN;
SELECT plan(39);

-- ---------------------------------------------------------------------
-- Scenario A: one pull request's whole story — eligibility, idempotent
-- replay, a stale-SHA delivery, a legitimate push continuing the same
-- cycle, and the three-attempt cap ending in exhaustion.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine A', 'gentic/engine-a', 'ENA', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'Story issue', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-a/pull/1', 'open', 'sha-1', 'unknown');

SELECT is(
  (SELECT enabled FROM public.issue_review_policies
    WHERE issue_id = 'a0000000-0000-4000-8000-000000000002'),
  true,
  'the policy snapshot inherits the project default'
);

CREATE TEMP TABLE eval_not_ready AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is((SELECT eligible FROM eval_not_ready), false, 'a PR without CI success is not eligible');

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-a/pull/1', p_ci_state => 'success'
);

CREATE TEMP TABLE eval1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is((SELECT action FROM eval1), 'queued', 'CI success queues the first automatic review run');
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'a0000000-0000-4000-8000-000000000002'),
  'reviewing',
  'the Issue moves to reviewing once a run is queued'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_runs
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval1)),
  1,
  'exactly one run exists for the new cycle'
);

CREATE TEMP TABLE eval_replay AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is((SELECT action FROM eval_replay), 'noop', 'replaying the same event does not queue a second run');
SELECT is(
  (SELECT count(*)::integer FROM public.review_runs
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval1)),
  1,
  'still exactly one run after the replay'
);

-- A push lands (new head SHA), then a stale CI-success delivery for the old
-- SHA arrives out of order.
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-a/pull/1', p_head_sha => 'sha-2'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-a/pull/1',
  p_ci_state => 'success',
  p_expected_head_sha => 'sha-1'
);

CREATE TEMP TABLE eval_stale AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is(
  (SELECT eligible FROM eval_stale),
  false,
  'a stale-SHA success delivery cannot make the newer head eligible'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM eval1)),
  'cancelled',
  'the run for the now-superseded head is paused rather than left live'
);

-- The legitimate CI success for the new head arrives.
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-a/pull/1',
  p_ci_state => 'success',
  p_expected_head_sha => 'sha-2'
);

CREATE TEMP TABLE eval_continue AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is(
  (SELECT action FROM eval_continue),
  'continued',
  'a push that lands while idle continues the same cycle'
);
SELECT is(
  (SELECT review_cycle_id FROM eval_continue),
  (SELECT review_cycle_id FROM eval1),
  'the cycle identity — and its attempt budget — survives the fix'
);
SELECT is(
  (SELECT head_sha FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval1)),
  'sha-2',
  'the cycle head SHA advances to the fixed commit'
);

-- Attempt 1: changes requested.
SELECT public.complete_review_attempt((SELECT review_run_id FROM eval_continue), 'changes_requested');
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'a0000000-0000-4000-8000-000000000002'),
  'changes-requested',
  'a changes-requested verdict surfaces on the Issue immediately, without waiting on a GitHub webhook'
);

-- Attempt 2 (a CI rerun re-triggers eligibility with no new push).
CREATE TEMP TABLE eval_attempt2 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT public.complete_review_attempt((SELECT review_run_id FROM eval_attempt2), 'changes_requested');

-- Attempt 3: the cap.
CREATE TEMP TABLE eval_attempt3 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT public.complete_review_attempt((SELECT review_run_id FROM eval_attempt3), 'changes_requested');

SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval1)),
  'exhausted',
  'the third changes-requested verdict exhausts the cycle and stops automatic progression'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval1)),
  3,
  'exactly three attempts were recorded — no more, no less'
);

CREATE TEMP TABLE eval_after_exhaustion AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-a/pull/1');
SELECT is(
  (SELECT action FROM eval_after_exhaustion),
  'noop',
  'an exhausted cycle does not queue a fourth attempt without new code'
);

-- Replaying a completed run is idempotent and ignores a different verdict.
CREATE TEMP TABLE replay_attempt AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_attempt3), 'approved');
SELECT is((SELECT accepted FROM replay_attempt), true, 'replaying a completed run is accepted idempotently');
SELECT is(
  (SELECT verdict FROM public.review_attempts WHERE id = (SELECT review_attempt_id FROM replay_attempt)),
  'changes_requested',
  'the replay returns the original verdict, ignoring the differing input'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval1)),
  3,
  'no duplicate attempt was created by the replay'
);

-- ---------------------------------------------------------------------
-- Scenario B: reviewer infrastructure failure — retry once, then stop
-- without publishing a verdict or consuming an attempt, and stay stopped
-- even if eligibility is re-evaluated again with no new code.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine B', 'gentic/engine-b', 'ENB', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'Infra issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-b/pull/1', 'open', 'sha-b1', 'success');

CREATE TEMP TABLE eval_infra1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-b/pull/1');
CREATE TEMP TABLE fail1 AS
SELECT * FROM public.fail_review_run((SELECT review_run_id FROM eval_infra1), 'boom');
SELECT is((SELECT retried FROM fail1), true, 'the first infrastructure failure retries automatically');

CREATE TEMP TABLE fail2 AS
SELECT * FROM public.fail_review_run((SELECT next_review_run_id FROM fail1), 'boom again');
SELECT is((SELECT retried FROM fail2), false, 'the retry failing too stops automatic progression');

SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval_infra1)),
  0,
  'infrastructure failures never consume an attempt'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_runs
    WHERE review_cycle_id = (SELECT review_cycle_id FROM eval_infra1)
      AND status in ('pending', 'running')),
  0,
  'no run is left live once the retry budget is spent — no verdict was published'
);

CREATE TEMP TABLE eval_infra_again AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-b/pull/1');
SELECT is(
  (SELECT action FROM eval_infra_again),
  'noop',
  'a later, unrelated re-evaluation does not resume a cycle stuck on spent infra retries'
);

-- ---------------------------------------------------------------------
-- Scenario C: a push landing mid-flight makes the in-progress run's
-- verdict moot — supersede and start over with a full budget.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine C', 'gentic/engine-c', 'ENC', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'Mid-flight issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-c/pull/1', 'open', 'sha-c1', 'success');

CREATE TEMP TABLE eval_mid1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-c/pull/1');

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-c/pull/1',
  p_head_sha => 'sha-c2',
  p_ci_state => 'success'
);

CREATE TEMP TABLE eval_mid2 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-c/pull/1');
SELECT is(
  (SELECT action FROM eval_mid2),
  'superseded_and_queued',
  'a push landing mid-flight supersedes the stale cycle and starts a fresh one'
);
SELECT isnt(
  (SELECT review_cycle_id FROM eval_mid2),
  (SELECT review_cycle_id FROM eval_mid1),
  'the fresh cycle after mid-flight supersession has a new identity'
);
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval_mid1)),
  'superseded',
  'the stale in-flight cycle is marked superseded'
);
SELECT is(
  (SELECT superseded_reason FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval_mid1)),
  'new_head_sha',
  'supersession records the new-head-SHA reason'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM eval_mid1)),
  'cancelled',
  'the stale in-flight run is cancelled, not left dangling'
);

-- ---------------------------------------------------------------------
-- Scenario D: a genuine human changes-requested review immediately
-- supersedes an active automatic run/cycle.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine D', 'gentic/engine-d', 'END', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'Human review issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-d/pull/1', 'open', 'sha-d1', 'success');

CREATE TEMP TABLE eval_human AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-d/pull/1');

CREATE TEMP TABLE supersede_human AS
SELECT * FROM public.supersede_active_review_cycle('https://github.com/gentic/engine-d/pull/1', 'human_review');
SELECT is((SELECT superseded FROM supersede_human), true, 'a human changes-requested review supersedes the active cycle');
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval_human)),
  'superseded',
  'the cycle is marked superseded for the human-review reason'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM eval_human)),
  'cancelled',
  'the live automatic run is cancelled when a human takes over'
);
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'd0000000-0000-4000-8000-000000000002'),
  'changes-requested',
  'the Issue reflects the human changes-requested outcome'
);

-- ---------------------------------------------------------------------
-- Scenario E: a bare human GitHub approval never auto-approves the Issue
-- while Automatic Review is enabled — only an automatic verdict or an
-- explicit `continue_with_human_review` does.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine E', 'gentic/engine-e', 'ENE', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'Gated approval issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-e/pull/1', 'open', 'sha-e1', 'success');

CREATE TEMP TABLE eval_gated AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/engine-e/pull/1');

-- A human approves the pull request directly on GitHub.
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/engine-e/pull/1', p_review_decision => 'approved'
);
SELECT isnt(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000002'),
  'approved',
  'a bare human approval does not auto-approve the Issue while Automatic Review is enabled'
);

-- The automatic reviewer itself approves.
SELECT public.complete_review_attempt((SELECT review_run_id FROM eval_gated), 'approved');
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000002'),
  'approved',
  'an automatic approved verdict does approve the Issue'
);
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM eval_gated)),
  'approved',
  'the cycle itself records the automatic approval'
);

-- ---------------------------------------------------------------------
-- Scenario F: `continue_with_human_review` is the one explicit override
-- that ends a cycle as approved without an automatic verdict.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'user_engine', 'Engine F', 'gentic/engine-f', 'ENF', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001',
   'Continue with human review issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('f0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/engine-f/pull/1', 'open', 'sha-f1', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/engine-f/pull/1');

CREATE TEMP TABLE continue_human AS
SELECT * FROM public.continue_with_human_review(
  'user_engine', 'f0000000-0000-4000-8000-000000000002'
);
SELECT is((SELECT status FROM continue_human), 'approved', 'continue_with_human_review approves the cycle');
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'f0000000-0000-4000-8000-000000000002'),
  'approved',
  'continue_with_human_review approves the Issue'
);

SELECT throws_ok(
  $$
    SELECT public.continue_with_human_review('user_other', 'f0000000-0000-4000-8000-000000000002')
  $$,
  'P0002',
  null,
  'continue_with_human_review is scoped to the owning user'
);

SELECT * FROM finish();
ROLLBACK;
