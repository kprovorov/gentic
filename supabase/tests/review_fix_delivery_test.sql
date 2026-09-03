-- Returns automatic review findings to the original implementation session
-- (GEN-417, see ADR-0007): session resumption, duplicate handoff, stale
-- heads, attempt exhaustion, and every unavailable-owner reason.
BEGIN;
SELECT plan(33);

-- ---------------------------------------------------------------------
-- Scenario A: the happy path — delivered to the resumable owner, and a
-- replay of the same Review Attempt is an idempotent no-op.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  'a1000000-0000-4000-8000-000000000004', 'user_417', 'Host A',
  repeat('a', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'user_417', 'Project A', 'gentic/fix-a', 'FXA', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  'Fix issue A', 'Body', 'in-progress', 1, 'claude_code',
  'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000005'
);
-- Establishes the durable implementation owner (generation 1).
UPDATE public.issues SET session_id = 'sess-a1'
 WHERE id = 'a1000000-0000-4000-8000-000000000002';
-- The run ends; the lease releases but the owner (and its session) persists.
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = 'a1000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-a/pull/1', 'open', 'sha-a1', 'success');

CREATE TEMP TABLE eval_a AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-a/pull/1');
CREATE TEMP TABLE attempt_a1 AS
SELECT * FROM public.complete_review_attempt(
  (SELECT review_run_id FROM eval_a), 'changes_requested', 'Please fix these.'
);

CREATE TEMP TABLE deliver_a1 AS
SELECT * FROM public.deliver_review_fix_request(
  (SELECT review_attempt_id FROM attempt_a1), 'Automatic review requested changes. Fix them.'
);
SELECT is((SELECT outcome FROM deliver_a1), 'delivered', 'a resumable owner receives the fix request');
SELECT is(
  (SELECT issue_id FROM deliver_a1),
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'the delivery result identifies the issue'
);
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_a1)),
  1, 'exactly one message was inserted'
);
SELECT is(
  (SELECT role FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_a1)),
  'user', 'the delivered message is authored as a user turn, so the agent resumes on it'
);
SELECT is(
  (SELECT author_type FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_a1)),
  'gentic', 'the delivered message is attributed to gentic, not a human'
);
SELECT is(
  (SELECT content FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_a1)),
  'Automatic review requested changes. Fix them.', 'the exact content is persisted verbatim'
);
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'a1000000-0000-4000-8000-000000000002'),
  'todo', 'the issue is requeued so the owning host resumes the session'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'a1000000-0000-4000-8000-000000000002'
      AND type = 'review_fix_delivered'),
  1, 'delivery is audited on the issue timeline'
);

-- Replaying the same completion (e.g. a retried webhook) must not queue a
-- second fix turn.
CREATE TEMP TABLE deliver_a1_again AS
SELECT * FROM public.deliver_review_fix_request(
  (SELECT review_attempt_id FROM attempt_a1), 'A different body — must be ignored'
);
SELECT is((SELECT outcome FROM deliver_a1_again), 'already_delivered', 'a duplicate delivery is a no-op');
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_a1)),
  1, 'no second message was inserted by the duplicate delivery'
);

-- ---------------------------------------------------------------------
-- Scenario B: a push lands between the attempt completing and delivery —
-- stale findings are never applied to the newer head.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  'b1000000-0000-4000-8000-000000000004', 'user_417', 'Host B',
  repeat('b', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'user_417', 'Project B', 'gentic/fix-b', 'FXB', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
  'Fix issue B', 'Body', 'in-progress', 1, 'claude_code',
  'b1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-b1'
 WHERE id = 'b1000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = 'b1000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-b/pull/1', 'open', 'sha-b1', 'success');

CREATE TEMP TABLE eval_b AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-b/pull/1');
CREATE TEMP TABLE attempt_b1 AS
SELECT * FROM public.complete_review_attempt(
  (SELECT review_run_id FROM eval_b), 'changes_requested'
);

-- A new commit lands before delivery runs. This also runs the existing,
-- unrelated `recompute_issue_status_from_pull_requests` (via
-- `apply_pull_request_delivery_state`), which can itself move the issue
-- off `changes-requested` — so the status right before calling
-- `deliver_review_fix_request` is captured dynamically below, rather than
-- assumed, to isolate what *this* delivery call does to it.
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/fix-b/pull/1', p_head_sha => 'sha-b2'
);

CREATE TEMP TABLE issue_status_before_deliver_b AS
SELECT status FROM public.issues WHERE id = 'b1000000-0000-4000-8000-000000000002';

CREATE TEMP TABLE deliver_b1 AS
SELECT * FROM public.deliver_review_fix_request(
  (SELECT review_attempt_id FROM attempt_b1), 'Fix these findings.'
);
SELECT is((SELECT outcome FROM deliver_b1), 'stale_head', 'findings produced against an old head are rejected once a newer push lands');
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_b1)),
  0, 'no fix-turn is queued for a stale head'
);
SELECT is(
  (SELECT status FROM public.issues WHERE id = 'b1000000-0000-4000-8000-000000000002'),
  (SELECT status FROM issue_status_before_deliver_b),
  'a rejected delivery does not itself change the issue status'
);

-- ---------------------------------------------------------------------
-- Scenario C: session resumption across repeated push/fix rounds, ending
-- in the third-attempt cap — automatic looping stops and delivery of the
-- exhausting attempt is rejected.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  'c1000000-0000-4000-8000-000000000004', 'user_417', 'Host C',
  repeat('c', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'user_417', 'Project C', 'gentic/fix-c', 'FXC', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
  'Fix issue C', 'Body', 'in-progress', 1, 'claude_code',
  'c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-c1'
 WHERE id = 'c1000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = 'c1000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-c/pull/1', 'open', 'sha-c1', 'success');

CREATE TEMP TABLE eval_c1 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-c/pull/1');
CREATE TEMP TABLE attempt_c1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_c1), 'changes_requested');
CREATE TEMP TABLE deliver_c1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_c1), 'Round 1 fixes.');
SELECT is((SELECT outcome FROM deliver_c1), 'delivered', 'attempt 1 of 3 is delivered to the owner');

CREATE TEMP TABLE eval_c2 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-c/pull/1');
CREATE TEMP TABLE attempt_c2 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_c2), 'changes_requested');
CREATE TEMP TABLE deliver_c2 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_c2), 'Round 2 fixes.');
SELECT is((SELECT outcome FROM deliver_c2), 'delivered', 'attempt 2 of 3 is also delivered — the cycle budget carries across fixes');
SELECT isnt(
  (SELECT review_attempt_id FROM attempt_c2),
  (SELECT review_attempt_id FROM attempt_c1),
  'each round produces a distinct Review Attempt, so both fix-turns coexist'
);
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = 'c1000000-0000-4000-8000-000000000002'
      AND review_attempt_id IS NOT NULL),
  2, 'two distinct fix-turns were queued across the two rounds'
);

CREATE TEMP TABLE eval_c3 AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-c/pull/1');
CREATE TEMP TABLE attempt_c3 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_c3), 'changes_requested');
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM attempt_c3)),
  'exhausted', 'the third changes-requested verdict exhausts the cycle'
);

CREATE TEMP TABLE deliver_c3 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_c3), 'Round 3 fixes.');
SELECT is(
  (SELECT outcome FROM deliver_c3),
  'cycle_not_active',
  'the exhausting third attempt is not delivered — automatic looping stops and requires human action'
);
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = 'c1000000-0000-4000-8000-000000000002'
      AND review_attempt_id IS NOT NULL),
  2, 'still only two fix-turns were ever queued for this issue'
);

-- ---------------------------------------------------------------------
-- Scenario D: a genuine human changes-requested review supersedes the
-- cycle before delivery runs — the pending automatic handoff is dropped.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  'd1000000-0000-4000-8000-000000000004', 'user_417', 'Host D',
  repeat('d', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'user_417', 'Project D', 'gentic/fix-d', 'FXD', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  'd1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001',
  'Fix issue D', 'Body', 'in-progress', 1, 'claude_code',
  'd1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-d1'
 WHERE id = 'd1000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = 'd1000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('d1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-d/pull/1', 'open', 'sha-d1', 'success');

CREATE TEMP TABLE eval_d AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-d/pull/1');
CREATE TEMP TABLE attempt_d1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_d), 'changes_requested');

SELECT public.supersede_active_review_cycle('https://github.com/gentic/fix-d/pull/1', 'human_review');

CREATE TEMP TABLE deliver_d1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_d1), 'Automatic fixes.');
SELECT is(
  (SELECT outcome FROM deliver_d1),
  'cycle_not_active',
  'a human changes-requested review superseding the cycle drops the pending automatic handoff'
);
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_d1)),
  0, 'the automatic fix-turn is never queued once a human took over'
);

-- ---------------------------------------------------------------------
-- Scenario E: no durable implementation owner was ever established.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'user_417', 'Project E', 'gentic/fix-e', 'FXE', true);
INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001',
   'Fix issue E', 'Body', 'ready-for-review', 1, 'claude_code');
INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-e/pull/1', 'open', 'sha-e1', 'success');
INSERT INTO public.review_cycles (id, issue_id, pull_request_id, head_sha) VALUES
  ('e1000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000002',
   'e1000000-0000-4000-8000-000000000003', 'sha-e1');
INSERT INTO public.review_runs (id, review_cycle_id, status, head_sha) VALUES
  ('e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000006', 'completed', 'sha-e1');
INSERT INTO public.review_attempts (id, review_cycle_id, review_run_id, attempt_number, verdict) VALUES
  ('e1000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000006',
   'e1000000-0000-4000-8000-000000000007', 1, 'changes_requested');

CREATE TEMP TABLE deliver_e1 AS
SELECT * FROM public.deliver_review_fix_request('e1000000-0000-4000-8000-000000000008', 'Fix these.');
SELECT is((SELECT outcome FROM deliver_e1), 'no_owner', 'an issue with no recorded implementation owner cannot receive a fix request');
SELECT is((SELECT unavailable_reason FROM deliver_e1), NULL, 'no_owner carries no unavailable_reason — there is no owner to describe');

-- ---------------------------------------------------------------------
-- Scenario F: the owner was reset to a fresh implementation (no session
-- yet) — the Issue no longer owns the session the findings were produced
-- against.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  'f1000000-0000-4000-8000-000000000004', 'user_417', 'Host F',
  repeat('f', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'user_417', 'Project F', 'gentic/fix-f', 'FXF', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001',
  'Fix issue F', 'Body', 'in-progress', 1, 'claude_code',
  'f1000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-f1'
 WHERE id = 'f1000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = 'f1000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-f/pull/1', 'open', 'sha-f1', 'success');

CREATE TEMP TABLE eval_f AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-f/pull/1');
CREATE TEMP TABLE attempt_f1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_f), 'changes_requested');

-- A user explicitly abandons the owner before delivery runs.
SELECT public.start_fresh_implementation(
  'user_417', 'f1000000-0000-4000-8000-000000000002'::uuid
);

CREATE TEMP TABLE deliver_f1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_f1), 'Fix these.');
SELECT is((SELECT outcome FROM deliver_f1), 'owner_unavailable', 'the reset owner has no session to resume');
SELECT is((SELECT unavailable_reason FROM deliver_f1), 'session_missing', 'the reason names the missing session specifically');
SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE review_attempt_id = (SELECT review_attempt_id FROM attempt_f1)),
  0, 'no fix-turn is queued for an owner that no longer owns a session'
);

-- ---------------------------------------------------------------------
-- Scenario G: the owning host was banned after the owner was established.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  '10000000-0000-4000-8000-000000000004', 'user_417', 'Host G',
  repeat('1', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('10000000-0000-4000-8000-000000000001', 'user_417', 'Project G', 'gentic/fix-g', 'FXG', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'Fix issue G', 'Body', 'in-progress', 1, 'claude_code',
  '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-g1'
 WHERE id = '10000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = '10000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-g/pull/1', 'open', 'sha-g1', 'success');

CREATE TEMP TABLE eval_g AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-g/pull/1');
CREATE TEMP TABLE attempt_g1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_g), 'changes_requested');

UPDATE public.hosts SET banned_at = now()
 WHERE id = '10000000-0000-4000-8000-000000000004';

CREATE TEMP TABLE deliver_g1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_g1), 'Fix these.');
SELECT is((SELECT outcome FROM deliver_g1), 'owner_unavailable', 'a banned owning host cannot receive a fix request');
SELECT is((SELECT unavailable_reason FROM deliver_g1), 'host_banned', 'the reason names the ban specifically');

-- ---------------------------------------------------------------------
-- Scenario H: the owning host was deleted after the owner was established.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  '11000000-0000-4000-8000-000000000004', 'user_417', 'Host H',
  repeat('2', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('11000000-0000-4000-8000-000000000001', 'user_417', 'Project H', 'gentic/fix-h', 'FXH', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  '11000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001',
  'Fix issue H', 'Body', 'in-progress', 1, 'claude_code',
  '11000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-h1'
 WHERE id = '11000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = '11000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-h/pull/1', 'open', 'sha-h1', 'success');

CREATE TEMP TABLE eval_h AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-h/pull/1');
CREATE TEMP TABLE attempt_h1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_h), 'changes_requested');

DELETE FROM public.hosts WHERE id = '11000000-0000-4000-8000-000000000004';

CREATE TEMP TABLE deliver_h1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_h1), 'Fix these.');
SELECT is((SELECT outcome FROM deliver_h1), 'owner_unavailable', 'a deleted owning host cannot receive a fix request');
SELECT is((SELECT unavailable_reason FROM deliver_h1), 'host_deleted', 'the reason names the deletion specifically');

-- ---------------------------------------------------------------------
-- Scenario I: the issue's agent provider changed after the owner was
-- established, invalidating the recorded session.
-- ---------------------------------------------------------------------
INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  '12000000-0000-4000-8000-000000000004', 'user_417', 'Host I',
  repeat('3', 64), 'ready', '2026-08-25T09:00:00Z', '{"providers":{}}'::jsonb
);
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('12000000-0000-4000-8000-000000000001', 'user_417', 'Project I', 'gentic/fix-i', 'FXI', true);
INSERT INTO public.issues (
  id, project_id, title, body, status, number, agent_provider,
  active_host_id, active_run_id
) VALUES (
  '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001',
  'Fix issue I', 'Body', 'in-progress', 1, 'claude_code',
  '12000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000005'
);
UPDATE public.issues SET session_id = 'sess-i1'
 WHERE id = '12000000-0000-4000-8000-000000000002';
UPDATE public.issues
   SET status = 'ready-for-review', active_run_id = null, active_host_id = null
 WHERE id = '12000000-0000-4000-8000-000000000002';

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('12000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000002',
   'https://github.com/gentic/fix-i/pull/1', 'open', 'sha-i1', 'success');

CREATE TEMP TABLE eval_i AS
SELECT * FROM public.evaluate_review_eligibility('https://github.com/gentic/fix-i/pull/1');
CREATE TEMP TABLE attempt_i1 AS
SELECT * FROM public.complete_review_attempt((SELECT review_run_id FROM eval_i), 'changes_requested');

UPDATE public.issues SET agent_provider = 'codex'
 WHERE id = '12000000-0000-4000-8000-000000000002';

CREATE TEMP TABLE deliver_i1 AS
SELECT * FROM public.deliver_review_fix_request((SELECT review_attempt_id FROM attempt_i1), 'Fix these.');
SELECT is((SELECT outcome FROM deliver_i1), 'owner_unavailable', 'a changed agent provider invalidates the recorded session');
SELECT is((SELECT unavailable_reason FROM deliver_i1), 'provider_changed', 'the reason names the provider change specifically');

SELECT * FROM finish();
ROLLBACK;
