-- GEN-419: every Automatic Review lifecycle transition writes exactly one
-- first-class `issue_events` row (review_queued/review_started/
-- review_approved/review_changes_requested/review_failed/review_superseded),
-- plus the new `retry_review_run` recovery RPC.
BEGIN;
SELECT plan(19);

-- ---------------------------------------------------------------------
-- Scenario 1: the happy path — queued, started, approved.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'user_events_1', 'Events A', 'gentic/events-a', 'EVA', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001',
   'Events issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/events-a/pull/1', 'open', 'sha-e1', 'success');

CREATE TEMP TABLE e1_eval AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/events-a/pull/1');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e1000000-0000-4000-8000-000000000002'
      AND type = 'review_queued'
      AND (payload->>'review_run_id')::uuid = (SELECT review_run_id FROM e1_eval)),
  1,
  'a queued review run writes one review_queued event'
);
SELECT is(
  (SELECT (payload->>'attempt_number')::integer FROM public.issue_events
    WHERE issue_id = 'e1000000-0000-4000-8000-000000000002' AND type = 'review_queued'),
  1,
  'the first attempt on a fresh cycle is numbered 1'
);

INSERT INTO public.workers (id, user_id, display_name, credential_hash) VALUES
  ('e1000000-0000-4000-8000-000000000004', 'user_events_1', 'Worker E1', repeat('1', 64));

CREATE TEMP TABLE e1_claim AS
SELECT * FROM public.claim_review_run('e1000000-0000-4000-8000-000000000004', 'user_events_1');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e1000000-0000-4000-8000-000000000002'
      AND type = 'review_started'
      AND (payload->>'review_run_id')::uuid = (SELECT review_run_id FROM e1_claim)),
  1,
  'claiming a run writes one review_started event'
);

CREATE TEMP TABLE e1_complete AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM e1_claim), 'approved');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e1000000-0000-4000-8000-000000000002'
      AND type = 'review_approved'
      AND payload->>'source' = 'automatic'),
  1,
  'an automatic approved verdict writes one review_approved event'
);
SELECT is(
  (SELECT (payload->>'attempt_number')::integer FROM public.issue_events
    WHERE issue_id = 'e1000000-0000-4000-8000-000000000002' AND type = 'review_approved'),
  1,
  'the approval event carries the attempt number that earned it'
);

-- ---------------------------------------------------------------------
-- Scenario 2: a changes-requested verdict carries its findings count.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'user_events_2', 'Events B', 'gentic/events-b', 'EVB', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   'Events issue B', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e2000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/events-b/pull/1', 'open', 'sha-e2', 'success');

CREATE TEMP TABLE e2_eval AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/events-b/pull/1');

SELECT public.complete_review_attempt(
  (SELECT review_run_id FROM e2_eval),
  'changes_requested',
  p_findings => '[{"severity":"warning","title":"Finding A"},{"severity":"error","title":"Finding B"}]'::jsonb
);

SELECT is(
  (SELECT payload->>'verdict' FROM public.issue_events
    WHERE issue_id = 'e2000000-0000-4000-8000-000000000002' AND type = 'review_changes_requested'),
  'changes_requested',
  'a changes-requested verdict writes one review_changes_requested event'
);
SELECT is(
  (SELECT (payload->>'findings_count')::integer FROM public.issue_events
    WHERE issue_id = 'e2000000-0000-4000-8000-000000000002' AND type = 'review_changes_requested'),
  2,
  'the event carries the findings count from that verdict'
);

-- ---------------------------------------------------------------------
-- Scenario 3: infrastructure failures — retried and then stopped.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'user_events_3', 'Events C', 'gentic/events-c', 'EVC', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001',
   'Events issue C', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/events-c/pull/1', 'open', 'sha-e3', 'success');

CREATE TEMP TABLE e3_eval AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/events-c/pull/1');
CREATE TEMP TABLE e3_fail1 AS
SELECT * FROM public.fail_review_run((SELECT review_run_id FROM e3_eval), 'boom');

SELECT is(
  (SELECT payload->>'retried' FROM public.issue_events
    WHERE issue_id = 'e3000000-0000-4000-8000-000000000002'
      AND type = 'review_failed'
      AND (payload->>'review_run_id')::uuid = (SELECT review_run_id FROM e3_eval)),
  'true',
  'the first infra failure writes a review_failed event marked retried'
);

CREATE TEMP TABLE e3_fail2 AS
SELECT * FROM public.fail_review_run((SELECT next_review_run_id FROM e3_fail1), 'boom again');

SELECT is(
  (SELECT payload->>'retried' FROM public.issue_events
    WHERE issue_id = 'e3000000-0000-4000-8000-000000000002'
      AND type = 'review_failed'
      AND (payload->>'review_run_id')::uuid = (SELECT next_review_run_id FROM e3_fail1)),
  'false',
  'the retry failing too writes a review_failed event marked not retried'
);

-- ---------------------------------------------------------------------
-- Scenario 4: a push mid-flight supersedes the stale cycle and queues a
-- fresh one — both events land.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'user_events_4', 'Events D', 'gentic/events-d', 'EVD', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
   'Events issue D', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/events-d/pull/1', 'open', 'sha-e4a', 'success');

CREATE TEMP TABLE e4_eval1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/events-d/pull/1');

SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/events-d/pull/1', p_head_sha => 'sha-e4b', p_ci_state => 'success'
);

CREATE TEMP TABLE e4_eval2 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/events-d/pull/1');

SELECT is(
  (SELECT payload->>'reason' FROM public.issue_events
    WHERE issue_id = 'e4000000-0000-4000-8000-000000000002'
      AND type = 'review_superseded'
      AND (payload->>'review_cycle_id')::uuid = (SELECT review_cycle_id FROM e4_eval1)),
  'new_head_sha',
  'the mid-flight push writes a review_superseded event for the stale cycle'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e4000000-0000-4000-8000-000000000002'
      AND type = 'review_queued'
      AND (payload->>'review_cycle_id')::uuid = (SELECT review_cycle_id FROM e4_eval2)),
  1,
  'the fresh cycle started by the supersession also writes its own review_queued event'
);

-- ---------------------------------------------------------------------
-- Scenario 5: `continue_with_human_review` records an approval sourced as
-- a human override, distinct from an automatic verdict.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'user_events_5', 'Events E', 'gentic/events-e', 'EVE', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001',
   'Events issue E', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/events-e/pull/1', 'open', 'sha-e5', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/events-e/pull/1');
SELECT public.continue_with_human_review('user_events_5', 'e5000000-0000-4000-8000-000000000002');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e5000000-0000-4000-8000-000000000002'
      AND type = 'review_approved'
      AND payload->>'source' = 'human_override'),
  1,
  'continue_with_human_review writes a review_approved event sourced as human_override'
);

-- ---------------------------------------------------------------------
-- Scenario R: `retry_review_run` — the explicit "retry now" recovery
-- primitive for a cycle stuck after two trailing infra failures.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('r1000000-0000-4000-8000-000000000001', 'user_retry_1', 'Retry A', 'gentic/retry-a', 'RTA', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('r1000000-0000-4000-8000-000000000002', 'r1000000-0000-4000-8000-000000000001',
   'Retry issue', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('r1000000-0000-4000-8000-000000000003', 'r1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/retry-a/pull/1', 'open', 'sha-r1', 'success');

CREATE TEMP TABLE r1_eval AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/retry-a/pull/1');
CREATE TEMP TABLE r1_fail1 AS
SELECT * FROM public.fail_review_run((SELECT review_run_id FROM r1_eval), 'boom');
SELECT public.fail_review_run((SELECT next_review_run_id FROM r1_fail1), 'boom again');

SELECT is(
  (SELECT count(*)::integer FROM public.review_runs
    WHERE review_cycle_id = (SELECT review_cycle_id FROM r1_eval)
      AND status IN ('pending', 'running')),
  0,
  'the cycle is stuck with no live run after two trailing infra failures'
);

CREATE TEMP TABLE r1_retry AS
SELECT * FROM public.retry_review_run('user_retry_1', (SELECT review_cycle_id FROM r1_eval));

SELECT isnt(
  (SELECT review_run_id FROM r1_retry),
  null,
  'retry_review_run queues a fresh run for the stuck cycle'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM r1_retry)),
  'pending',
  'the retried run starts pending, ready to be claimed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'r1000000-0000-4000-8000-000000000002'
      AND type = 'review_queued'
      AND (payload->>'review_cycle_id')::uuid = (SELECT review_cycle_id FROM r1_eval)),
  2,
  'the manual retry writes its own review_queued event alongside the original one'
);

SELECT throws_ok(
  $$
    SELECT public.retry_review_run('user_other', (
      SELECT review_cycle_id FROM r1_eval
    ))
  $$,
  'P0002',
  null,
  'retry_review_run is scoped to the owning user'
);
SELECT throws_ok(
  $$
    SELECT public.retry_review_run('user_retry_1', (
      SELECT review_cycle_id FROM r1_eval
    ))
  $$,
  '23514',
  null,
  'retry_review_run refuses to queue a second run while one is already live'
);

-- Exhaust a fresh cycle's attempt budget, then retry_review_run must refuse
-- the now-concluded (not `active`) cycle.
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('r2000000-0000-4000-8000-000000000001', 'user_retry_2', 'Retry B', 'gentic/retry-b', 'RTB', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('r2000000-0000-4000-8000-000000000002', 'r2000000-0000-4000-8000-000000000001',
   'Retry issue B', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('r2000000-0000-4000-8000-000000000003', 'r2000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/retry-b/pull/1', 'open', 'sha-r2', 'success');

CREATE TEMP TABLE r2_eval1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/retry-b/pull/1');
SELECT public.complete_review_attempt((SELECT review_run_id FROM r2_eval1), 'changes_requested');
CREATE TEMP TABLE r2_eval2 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/retry-b/pull/1');
SELECT public.complete_review_attempt((SELECT review_run_id FROM r2_eval2), 'changes_requested');
CREATE TEMP TABLE r2_eval3 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/retry-b/pull/1');
SELECT public.complete_review_attempt((SELECT review_run_id FROM r2_eval3), 'changes_requested');

SELECT throws_ok(
  $$
    SELECT public.retry_review_run('user_retry_2', (
      SELECT review_cycle_id FROM r2_eval1
    ))
  $$,
  '23514',
  null,
  'retry_review_run refuses an exhausted (no longer active) cycle'
);

SELECT * FROM finish();
ROLLBACK;
