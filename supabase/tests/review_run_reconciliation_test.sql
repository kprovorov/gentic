-- Review job offline-worker reconciliation (GEN-414 / ADR-0005):
-- `reconcile_offline_review_runs` fails a claimed review run whose worker
-- has gone dark, or whose reviewer session itself stopped heartbeating on
-- an otherwise-live worker, by reusing `fail_review_run` — so it inherits
-- that RPC's no-attempt-consumed retry-then-stop semantics rather than
-- introducing a new terminal state.
BEGIN;
SELECT plan(24);

SELECT has_extension('pg_cron', 'pg_cron is enabled for reliable scheduling');

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'reconcile-offline-review-runs'),
  '30 seconds',
  'offline-review-run reconciliation runs every 30 seconds'
);

SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'reconcile-offline-review-runs'),
  'select public.reconcile_offline_review_runs();',
  'cron invokes the atomic database reconciliation function'
);

INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'recon_test_user', 'Recon Project', 'gentic/recon-project', 'RCN', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001', 'Stale worker', 'Body', 'ready-for-review', 1, 'claude_code'),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001', 'Fresh worker', 'Body', 'ready-for-review', 2, 'claude_code'),
  ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000001', 'Stale heartbeat only', 'Body', 'ready-for-review', 3, 'claude_code'),
  ('d0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000001', 'Two consecutive failures', 'Body', 'ready-for-review', 4, 'claude_code'),
  ('d0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000001', 'Never claimed', 'Body', 'ready-for-review', 5, 'claude_code'),
  ('d0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000001', 'Banned worker holds the claim', 'Body', 'ready-for-review', 6, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000011', 'https://github.com/gentic/recon-project/pull/1', 'open', 'sha-1', 'success'),
  ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000012', 'https://github.com/gentic/recon-project/pull/2', 'open', 'sha-2', 'success'),
  ('d0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000013', 'https://github.com/gentic/recon-project/pull/3', 'open', 'sha-3', 'success'),
  ('d0000000-0000-4000-8000-000000000024', 'd0000000-0000-4000-8000-000000000014', 'https://github.com/gentic/recon-project/pull/4', 'open', 'sha-4', 'success'),
  ('d0000000-0000-4000-8000-000000000025', 'd0000000-0000-4000-8000-000000000015', 'https://github.com/gentic/recon-project/pull/5', 'open', 'sha-5', 'success'),
  ('d0000000-0000-4000-8000-000000000026', 'd0000000-0000-4000-8000-000000000016', 'https://github.com/gentic/recon-project/pull/6', 'open', 'sha-6', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/1');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/2');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/3');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/4');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/5');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/recon-project/pull/6');

INSERT INTO public.workers (id, user_id, display_name, credential_hash, last_seen_at, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000031', 'recon_test_user', 'Stale Worker', repeat('1', 64), '2026-08-19T11:54:00Z', '2026-08-19T11:54:00Z'),
  ('d0000000-0000-4000-8000-000000000032', 'recon_test_user', 'Fresh Worker', repeat('2', 64), '2026-08-19T11:59:00Z', '2026-08-19T11:59:00Z'),
  ('d0000000-0000-4000-8000-000000000033', 'recon_test_user', 'Stale Heartbeat Worker', repeat('3', 64), '2026-08-19T11:59:00Z', '2026-08-19T11:59:00Z'),
  ('d0000000-0000-4000-8000-000000000034', 'recon_test_user', 'Two Strikes Worker', repeat('4', 64), '2026-08-19T11:54:00Z', '2026-08-19T11:54:00Z');

INSERT INTO public.workers (id, user_id, display_name, credential_hash, last_seen_at, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000036', 'recon_test_user', 'Banned Worker', repeat('6', 64), '2026-08-19T11:54:00Z', '2026-08-19T11:54:00Z');

-- Claim every run except issue 5's, which stays pending throughout. Every
-- claim's `p_now` is pinned so `started_at` (the heartbeat fallback) is
-- deterministic, instead of depending on the real wall clock the test
-- happens to run at.
CREATE TEMP TABLE claim1 AS SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000031', 'recon_test_user', '2026-08-19T11:59:30Z'::timestamptz);
CREATE TEMP TABLE claim2 AS SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000032', 'recon_test_user', '2026-08-19T11:59:30Z'::timestamptz);
CREATE TEMP TABLE claim3 AS SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000033', 'recon_test_user', '2026-08-19T11:59:30Z'::timestamptz);
CREATE TEMP TABLE claim4 AS SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000034', 'recon_test_user', '2026-08-19T11:59:30Z'::timestamptz);
-- Issue 5's run is otherwise the oldest still-pending row once 1-4 are
-- claimed, and `claim_review_run` is a plain FIFO queue with no per-call
-- targeting -- without outranking it, this claim would silently take issue
-- 5's run instead of issue 6's, contradicting "issue 5 stays pending
-- throughout" below.
UPDATE public.issues
   SET priority = 'urgent'
 WHERE id = 'd0000000-0000-4000-8000-000000000016';

-- Claimed while healthy and unbanned; banned only afterward, to prove the
-- reconciler skips it because it is *currently* banned, not because a
-- banned worker could never have claimed it in the first place.
CREATE TEMP TABLE claim6 AS SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000036', 'recon_test_user', '2026-08-19T11:59:30Z'::timestamptz);

UPDATE public.workers
   SET banned_at = '2026-08-19T11:59:45Z',
       last_seen_at = null
 WHERE id = 'd0000000-0000-4000-8000-000000000036';

-- Issue 3's run is claimed by a *fresh* worker, but the run itself stopped
-- heartbeating — the reconciler must catch this even though the worker
-- looks perfectly healthy.
UPDATE public.review_runs
   SET heartbeat_at = '2026-08-19T11:54:00Z'
 WHERE id = (SELECT review_run_id FROM claim3);

SELECT is(
  public.reconcile_offline_review_runs('2026-08-19T12:00:00Z'::timestamptz),
  3,
  'one pass reconciles the stale-worker, stale-heartbeat, and two-strikes-worker runs (not the fresh or banned-worker ones)'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM claim1)),
  'failed',
  'the stale worker''s run is failed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts WHERE review_cycle_id = (SELECT review_cycle_id FROM claim1)),
  0,
  'reconciliation never consumes a Review Attempt'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim1) AND status = 'pending'),
  1,
  'the stale-worker run automatically retries with a fresh pending run in the same cycle'
);
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM claim1)),
  'active',
  'the cycle stays active across the automatic retry'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM claim2)),
  'running',
  'a run held by a worker within the 5-minute window is untouched'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM claim3)),
  'failed',
  'a stale run heartbeat fails the run even though the worker itself looks healthy'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM claim4)),
  'failed',
  'the two-strikes worker''s first failure is reconciled normally'
);

CREATE TEMP TABLE claim4_retry AS
SELECT * FROM public.review_runs
 WHERE review_cycle_id = (SELECT review_cycle_id FROM claim4) AND status = 'pending';

-- `claim_review_run` is a plain FIFO queue (priority desc, created_at asc)
-- with no worker affinity, and pull/5's still-pending run is older than any
-- retry created above -- without this, the "same worker" reclaim below would
-- nondeterministically win pull/5's run instead of its own retry. Bumping
-- issue 4's priority is the only lever that reliably outranks it.
UPDATE public.issues
   SET priority = 'urgent'
 WHERE id = 'd0000000-0000-4000-8000-000000000014';

-- The automatic retry is itself claimed and then also goes stale.
CREATE TEMP TABLE reclaim4 AS
SELECT * FROM public.claim_review_run('d0000000-0000-4000-8000-000000000034', 'recon_test_user', '2026-08-19T12:01:00Z'::timestamptz);

SELECT is(
  (SELECT review_run_id FROM reclaim4),
  (SELECT id FROM claim4_retry),
  'the same worker re-claims its own automatic retry'
);

UPDATE public.workers
   SET last_seen_at = '2026-08-19T12:24:00Z',
       updated_at = '2026-08-19T12:24:00Z'
 WHERE id = 'd0000000-0000-4000-8000-000000000034';

-- The fresh worker, and the run it's holding, were only ever given a
-- timestamp once back at setup time (`started_at`, since `heartbeat_at` was
-- never set); without refreshing both, either one reads as offline/stale by
-- this second, much later pass and the run gets wrongly reconciled
-- alongside the two-strikes worker's run.
UPDATE public.workers
   SET last_seen_at = '2026-08-19T12:29:00Z',
       updated_at = '2026-08-19T12:29:00Z'
 WHERE id = 'd0000000-0000-4000-8000-000000000032';

UPDATE public.review_runs
   SET heartbeat_at = '2026-08-19T12:29:00Z'
 WHERE id = (SELECT review_run_id FROM claim2);

SELECT is(
  public.reconcile_offline_review_runs('2026-08-19T12:30:00Z'::timestamptz),
  1,
  'a second stale pass reconciles only the two-strikes worker''s retried run'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT id FROM claim4_retry)),
  'failed',
  'the retried run also fails on its second consecutive infra failure'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_runs WHERE review_cycle_id = (SELECT review_cycle_id FROM claim4) AND status = 'pending'),
  0,
  'two consecutive failures at the same head SHA stop automatic progression — no third retry is queued'
);
SELECT is(
  (SELECT state FROM public.review_cycles WHERE id = (SELECT review_cycle_id FROM claim4)),
  'active',
  'the cycle is left active with no live run, recoverable by a human or new code'
);
SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts WHERE review_cycle_id = (SELECT review_cycle_id FROM claim4)),
  0,
  'even after two infra failures, no Review Attempt was ever consumed'
);

SELECT is(
  (SELECT status FROM public.review_runs rr JOIN public.review_cycles rc ON rc.id = rr.review_cycle_id WHERE rc.issue_id = 'd0000000-0000-4000-8000-000000000015'),
  'pending',
  'a never-claimed run is untouched by reconciliation regardless of any worker''s staleness'
);

SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT review_run_id FROM claim6)),
  'running',
  'a banned worker''s running review run is left alone by this reconciler (released separately on ban)'
);

SELECT is(
  public.reconcile_offline_review_runs('2026-08-19T12:30:00Z'::timestamptz),
  0,
  'a repeated reconciliation pass with nothing newly stale is a no-op'
);

SELECT is(
  (SELECT last_seen_at FROM public.workers WHERE id = 'd0000000-0000-4000-8000-000000000031'),
  '2026-08-19T11:54:00+00'::timestamptz,
  'reconciliation does not mutate the stale worker record itself'
);

-- ---------------------------------------------------------------------
-- Restart resumes cleanly (GEN-420): a worker that went offline mid-review,
-- had its run reconciled, and later comes back online must be able to
-- claim the pending retry reconciliation left behind and proceed normally
-- -- reconciliation's job is to make the work claimable again, not just to
-- mark the old run failed. Kept in its own account/timestamp namespace so
-- it doesn't disturb the finely-tuned timeline above.
-- ---------------------------------------------------------------------
INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('d9000000-0000-4000-8000-000000000001', 'recon_restart_user', 'Restart Project', 'gentic/restart-project', 'RST', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('d9000000-0000-4000-8000-000000000011', 'd9000000-0000-4000-8000-000000000001', 'Restarted worker', 'Body', 'ready-for-review', 1, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('d9000000-0000-4000-8000-000000000021', 'd9000000-0000-4000-8000-000000000011', 'https://github.com/gentic/restart-project/pull/1', 'open', 'sha-restart-1', 'success');

SELECT public.evaluate_review_eligibility('https://github.com/gentic/restart-project/pull/1');

INSERT INTO public.workers (id, user_id, display_name, credential_hash, last_seen_at, updated_at) VALUES
  ('d9000000-0000-4000-8000-000000000031', 'recon_restart_user', 'Restarting Worker', repeat('9', 64), '2026-08-19T13:00:00Z', '2026-08-19T13:00:00Z');

CREATE TEMP TABLE restart_claim AS
SELECT * FROM public.claim_review_run('d9000000-0000-4000-8000-000000000031', 'recon_restart_user', '2026-08-19T13:00:30Z'::timestamptz);

-- The worker crashes: no further heartbeat, and it goes fully silent
-- (offline) well past the 5-minute staleness window.
UPDATE public.workers
   SET last_seen_at = null,
       offline_since_at = '2026-08-19T13:01:00Z'
 WHERE id = 'd9000000-0000-4000-8000-000000000031';

SELECT is(
  public.reconcile_offline_review_runs('2026-08-19T13:10:00Z'::timestamptz),
  1,
  'the crashed worker''s run is reconciled'
);

CREATE TEMP TABLE restart_retry AS
SELECT * FROM public.review_runs
 WHERE review_cycle_id = (SELECT review_cycle_id FROM restart_claim) AND status = 'pending';

-- The same worker identity restarts (per GEN-412, `GENTIC_WORKER_ID`/
-- credential persist across restarts) and resumes polling.
UPDATE public.workers
   SET last_seen_at = '2026-08-19T13:15:00Z',
       offline_since_at = null,
       updated_at = '2026-08-19T13:15:00Z'
 WHERE id = 'd9000000-0000-4000-8000-000000000031';

CREATE TEMP TABLE restart_reclaim AS
SELECT * FROM public.claim_review_run('d9000000-0000-4000-8000-000000000031', 'recon_restart_user', '2026-08-19T13:15:05Z'::timestamptz);

SELECT is(
  (SELECT review_run_id FROM restart_reclaim),
  (SELECT id FROM restart_retry),
  'the restarted worker successfully claims the pending run reconciliation freed for it'
);
SELECT is(
  (SELECT status FROM public.review_runs WHERE id = (SELECT id FROM restart_retry)),
  'running',
  'the reclaimed run proceeds to running, exactly as any other fresh claim would'
);

SELECT * FROM finish();
ROLLBACK;
