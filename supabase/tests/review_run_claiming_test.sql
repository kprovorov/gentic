-- Review job claiming (GEN-414 / ADR-0005): `claim_review_run` atomically
-- assigns the next eligible pending `review_runs` row to a host, ordered
-- by the owning Issue's priority, and excludes rows a host must never see
-- (another account's, a banned host's, or a row whose pull request has
-- since gone draft).
--
-- Each scenario below uses its own account so the scenarios' claim queues
-- never interact — with one shared FIFO/priority queue per account, mixing
-- unrelated pending runs into one scenario would make "claims nothing"
-- assertions ambiguous (a host refused one job might legitimately claim a
-- different one still sitting in the same queue).
BEGIN;
SELECT plan(16);

-- ---------------------------------------------------------------------
-- Scenario 1 (account `claim_priority_user`): priority ordering.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'claim_priority_user', 'Priority Project', 'gentic/priority-project', 'PRI', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider, priority) VALUES
  ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000001', 'High priority', 'Body', 'ready-for-review', 1, 'claude_code', 'urgent'),
  ('c1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000001', 'Low priority', 'Body', 'ready-for-review', 2, 'claude_code', 'low');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000011', 'https://github.com/gentic/priority-project/pull/1', 'open', 'sha-high', 'success'),
  ('c1000000-0000-4000-8000-000000000022', 'c1000000-0000-4000-8000-000000000012', 'https://github.com/gentic/priority-project/pull/2', 'open', 'sha-low', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/priority-project/pull/1');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/priority-project/pull/2');

INSERT INTO public.hosts (id, user_id, display_name, credential_hash) VALUES
  ('c1000000-0000-4000-8000-000000000031', 'claim_priority_user', 'Host A', repeat('a', 64)),
  ('c1000000-0000-4000-8000-000000000032', 'claim_priority_user', 'Host B', repeat('b', 64));

CREATE TEMP TABLE claim_high AS
SELECT * FROM public.claim_review_run('c1000000-0000-4000-8000-000000000031', 'claim_priority_user');

SELECT is(
  (SELECT issue_id FROM claim_high),
  'c1000000-0000-4000-8000-000000000011'::uuid,
  'the highest-priority queued review run is claimed first'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim_high)),
  'running',
  'claiming flips the run to running'
);
SELECT is(
  (SELECT claimed_by_host_id FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim_high)),
  'c1000000-0000-4000-8000-000000000031'::uuid,
  'the claiming host is recorded on the run'
);
SELECT isnt(
  (SELECT started_at FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim_high)),
  null,
  'claiming stamps a claim/start timestamp'
);

CREATE TEMP TABLE claim_low AS
SELECT * FROM public.claim_review_run('c1000000-0000-4000-8000-000000000032', 'claim_priority_user');

SELECT is(
  (SELECT issue_id FROM claim_low),
  'c1000000-0000-4000-8000-000000000012'::uuid,
  'the next claim picks the only remaining (lower-priority) run'
);

-- ---------------------------------------------------------------------
-- Scenario 2 (account `claim_contest_user`): two hosts cannot claim the
-- same review job.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'claim_contest_user', 'Contest Project', 'gentic/contest-project', 'CON', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('c2000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000001', 'Contested job', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c2000000-0000-4000-8000-000000000021', 'c2000000-0000-4000-8000-000000000011', 'https://github.com/gentic/contest-project/pull/1', 'open', 'sha-contested', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/contest-project/pull/1');

INSERT INTO public.hosts (id, user_id, display_name, credential_hash) VALUES
  ('c2000000-0000-4000-8000-000000000031', 'claim_contest_user', 'Host C', repeat('c', 64)),
  ('c2000000-0000-4000-8000-000000000032', 'claim_contest_user', 'Host D', repeat('d', 64));

CREATE TEMP TABLE claim_winner AS
SELECT * FROM public.claim_review_run('c2000000-0000-4000-8000-000000000031', 'claim_contest_user');

SELECT is(
  (SELECT issue_id FROM claim_winner),
  'c2000000-0000-4000-8000-000000000011'::uuid,
  'host C wins the contested job'
);
SELECT is(
  (SELECT count(*)::integer FROM public.claim_review_run('c2000000-0000-4000-8000-000000000032', 'claim_contest_user')),
  0,
  'host D racing for the same, now-running job gets nothing'
);
SELECT is(
  (SELECT claimed_by_host_id FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim_winner)),
  'c2000000-0000-4000-8000-000000000031'::uuid,
  'the contested job stays claimed by the original winner'
);

-- ---------------------------------------------------------------------
-- Scenario 3 (account `claim_banned_user`): a banned host never claims,
-- even though the job is still genuinely available.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'claim_banned_user', 'Banned Host Project', 'gentic/banned-host-project', 'BAN', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('c3000000-0000-4000-8000-000000000011', 'c3000000-0000-4000-8000-000000000001', 'Banned host target', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c3000000-0000-4000-8000-000000000021', 'c3000000-0000-4000-8000-000000000011', 'https://github.com/gentic/banned-host-project/pull/1', 'open', 'sha-banned', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/banned-host-project/pull/1');

INSERT INTO public.hosts (id, user_id, display_name, credential_hash, banned_at) VALUES
  ('c3000000-0000-4000-8000-000000000031', 'claim_banned_user', 'Banned Host', repeat('e', 64), now());
INSERT INTO public.hosts (id, user_id, display_name, credential_hash) VALUES
  ('c3000000-0000-4000-8000-000000000032', 'claim_banned_user', 'Eligible Host', repeat('f', 64));

SELECT is(
  (SELECT count(*)::integer FROM public.claim_review_run('c3000000-0000-4000-8000-000000000031', 'claim_banned_user')),
  0,
  'a banned host cannot claim any review run'
);
SELECT is(
  (SELECT status FROM public.review_runs rr JOIN public.review_cycles rc ON rc.id = rr.review_cycle_id WHERE rc.issue_id = 'c3000000-0000-4000-8000-000000000011'),
  'pending',
  'the run a banned host failed to claim is still claimable by someone else'
);

CREATE TEMP TABLE claim_after_ban_refused AS
SELECT * FROM public.claim_review_run('c3000000-0000-4000-8000-000000000032', 'claim_banned_user');

SELECT is(
  (SELECT issue_id FROM claim_after_ban_refused),
  'c3000000-0000-4000-8000-000000000011'::uuid,
  'an eligible host claims the job the banned host could not'
);

-- ---------------------------------------------------------------------
-- Scenario 4 (accounts `claim_cross_a` / `claim_cross_b`): cross-tenant
-- isolation — a host/user pair that does not match never sees another
-- account's queue, and never sees a queue under the wrong account id either.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c4000000-0000-4000-8000-000000000001', 'claim_cross_a', 'Cross A Project', 'gentic/cross-a-project', 'CRA', true),
  ('c4000000-0000-4000-8000-000000000002', 'claim_cross_b', 'Cross B Project', 'gentic/cross-b-project', 'CRB', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('c4000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000001', 'Account A issue', 'Body', 'ready-for-review', 1, 'claude_code'),
  ('c4000000-0000-4000-8000-000000000012', 'c4000000-0000-4000-8000-000000000002', 'Account B issue', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c4000000-0000-4000-8000-000000000021', 'c4000000-0000-4000-8000-000000000011', 'https://github.com/gentic/cross-a-project/pull/1', 'open', 'sha-a', 'success'),
  ('c4000000-0000-4000-8000-000000000022', 'c4000000-0000-4000-8000-000000000012', 'https://github.com/gentic/cross-b-project/pull/1', 'open', 'sha-b', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/cross-a-project/pull/1');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/cross-b-project/pull/1');

INSERT INTO public.hosts (id, user_id, display_name, credential_hash) VALUES
  ('c4000000-0000-4000-8000-000000000031', 'claim_cross_a', 'Host A', repeat('1', 64)),
  ('c4000000-0000-4000-8000-000000000032', 'claim_cross_b', 'Host B', repeat('2', 64));

SELECT is(
  (SELECT count(*)::integer FROM public.claim_review_run('c4000000-0000-4000-8000-000000000031', 'claim_cross_b')),
  0,
  'account A''s host cannot claim under account B''s id'
);
SELECT is(
  (SELECT count(*)::integer FROM public.claim_review_run('c4000000-0000-4000-8000-000000000032', 'claim_cross_a')),
  0,
  'account B''s host cannot claim under account A''s id'
);

CREATE TEMP TABLE claim_cross_a AS
SELECT * FROM public.claim_review_run('c4000000-0000-4000-8000-000000000031', 'claim_cross_a');

SELECT is(
  (SELECT issue_id FROM claim_cross_a),
  'c4000000-0000-4000-8000-000000000011'::uuid,
  'account A''s own host under its own id claims its own queued review run'
);

-- ---------------------------------------------------------------------
-- Scenario 5 (account `claim_draft_user`): a pull request that went draft
-- after its run was queued is skipped, even though the row is still
-- `pending` (the webhook that will eventually cancel it has not fired yet)
-- — the claim query re-checks pull request state itself.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('c5000000-0000-4000-8000-000000000001', 'claim_draft_user', 'Draft Project', 'gentic/draft-project', 'DRF', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('c5000000-0000-4000-8000-000000000011', 'c5000000-0000-4000-8000-000000000001', 'Goes draft mid-flight', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('c5000000-0000-4000-8000-000000000021', 'c5000000-0000-4000-8000-000000000011', 'https://github.com/gentic/draft-project/pull/1', 'open', 'sha-draft', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/draft-project/pull/1');
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/gentic/draft-project/pull/1', p_state => 'draft'
);

INSERT INTO public.hosts (id, user_id, display_name, credential_hash) VALUES
  ('c5000000-0000-4000-8000-000000000031', 'claim_draft_user', 'Host', repeat('9', 64));

SELECT is(
  (SELECT count(*)::integer FROM public.claim_review_run('c5000000-0000-4000-8000-000000000031', 'claim_draft_user')),
  0,
  'a run backed by a now-draft pull request is never claimed'
);
SELECT is(
  (SELECT status FROM public.review_runs rr JOIN public.review_cycles rc ON rc.id = rr.review_cycle_id WHERE rc.issue_id = 'c5000000-0000-4000-8000-000000000011'),
  'pending',
  'the draft-backed run is left untouched, not claimed or cancelled'
);

SELECT * FROM finish();
ROLLBACK;
