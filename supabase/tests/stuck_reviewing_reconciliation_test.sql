-- Stuck-`reviewing` reconciliation (GEN-449):
-- `issues.status = 'reviewing'` is written once, when a run is queued, and
-- no path in the review engine writes it back when the cycle stops moving.
-- `reconcile_stuck_reviewing_issues` restores the invariant by re-deriving
-- the status from the pull requests whenever nothing is actually reviewing
-- the Issue -- and, just as importantly, keeps its hands off an Issue whose
-- review is genuinely still in flight.
BEGIN;
SELECT plan(18);

SELECT has_extension('pg_cron', 'pg_cron is enabled for reliable scheduling');

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'reconcile-stuck-reviewing-issues'),
  '1 minute',
  'stuck-reviewing reconciliation runs every minute'
);

SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'reconcile-stuck-reviewing-issues'),
  'select public.reconcile_stuck_reviewing_issues();',
  'cron invokes the atomic database reconciliation function'
);

INSERT INTO public.projects (id, user_id, name, repo, key, automatic_review_enabled) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'stuck_test_user', 'Stuck Project', 'gentic/stuck-project', 'STK', true);

INSERT INTO public.issues (id, project_id, title, body, status, number, agent_provider) VALUES
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000001', 'Dead-ended cycle', 'Body', 'ready-for-review', 1, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000001', 'Silently approved', 'Body', 'ready-for-review', 2, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000001', 'Claimable pending run', 'Body', 'ready-for-review', 3, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000001', 'Running run', 'Body', 'ready-for-review', 4, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000015', 'e0000000-0000-4000-8000-000000000001', 'Just transitioned', 'Body', 'ready-for-review', 5, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000016', 'e0000000-0000-4000-8000-000000000001', 'Stranded pending run', 'Body', 'ready-for-review', 6, 'claude_code'),
  ('e0000000-0000-4000-8000-000000000017', 'e0000000-0000-4000-8000-000000000001', 'Parked by hand', 'Body', 'ready-for-review', 7, 'claude_code');

INSERT INTO public.issue_pull_requests (id, issue_id, url, state, head_sha, ci_state) VALUES
  ('e0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000011', 'https://github.com/gentic/stuck-project/pull/1', 'open', 'sha-1', 'success'),
  ('e0000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000012', 'https://github.com/gentic/stuck-project/pull/2', 'open', 'sha-2', 'success'),
  ('e0000000-0000-4000-8000-000000000023', 'e0000000-0000-4000-8000-000000000013', 'https://github.com/gentic/stuck-project/pull/3', 'open', 'sha-3', 'success'),
  ('e0000000-0000-4000-8000-000000000024', 'e0000000-0000-4000-8000-000000000014', 'https://github.com/gentic/stuck-project/pull/4', 'open', 'sha-4', 'success'),
  ('e0000000-0000-4000-8000-000000000025', 'e0000000-0000-4000-8000-000000000015', 'https://github.com/gentic/stuck-project/pull/5', 'open', 'sha-5', 'success'),
  ('e0000000-0000-4000-8000-000000000026', 'e0000000-0000-4000-8000-000000000016', 'https://github.com/gentic/stuck-project/pull/6', 'open', 'sha-6', 'success'),
  ('e0000000-0000-4000-8000-000000000027', 'e0000000-0000-4000-8000-000000000017', 'https://github.com/gentic/stuck-project/pull/7', 'open', 'sha-7', 'success');

-- Every issue takes the real route into `reviewing`: a queued review run.
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/1');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/2');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/3');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/4');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/5');
SELECT public.evaluate_review_eligibility('https://github.com/gentic/stuck-project/pull/6');

SELECT is(
  (SELECT count(*)::integer FROM public.issues
    WHERE project_id = 'e0000000-0000-4000-8000-000000000001' AND status = 'reviewing'),
  6,
  'queueing a run puts every issue in reviewing'
);

-- Issue 7 never had a run evaluated for it: `reviewing` is an ordinary
-- selectable status, and this stands in for a user parking an issue there by
-- hand. Automatic Review has produced nothing for it, so it is not the
-- reconciler's to re-derive.
UPDATE public.issues
   SET status = 'reviewing'
 WHERE id = 'e0000000-0000-4000-8000-000000000017';

INSERT INTO public.hosts (id, user_id, display_name, credential_hash, last_seen_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000031', 'stuck_test_user', 'Stuck Host', repeat('a', 64), '2026-09-09T11:59:00Z', '2026-09-09T11:59:00Z');

-- Issue 1: the documented dead end. Two infrastructure failures at the same
-- commit spend `fail_review_run`'s retry budget, so the cycle is left active
-- with nothing queued and nothing ever writes the issue's status again.
SELECT public.fail_review_run(
  (SELECT id FROM public.review_runs WHERE review_cycle_id =
    (SELECT id FROM public.review_cycles WHERE issue_id = 'e0000000-0000-4000-8000-000000000011')
    AND status = 'pending'),
  'Reviewer crashed',
  '2026-09-09T11:50:00Z'::timestamptz
);
SELECT public.fail_review_run(
  (SELECT id FROM public.review_runs WHERE review_cycle_id =
    (SELECT id FROM public.review_cycles WHERE issue_id = 'e0000000-0000-4000-8000-000000000011')
    AND status = 'pending'),
  'Reviewer crashed again',
  '2026-09-09T11:51:00Z'::timestamptz
);

SELECT is(
  (SELECT count(*)::integer FROM public.review_runs rr
     JOIN public.review_cycles rc ON rc.id = rr.review_cycle_id
    WHERE rc.issue_id = 'e0000000-0000-4000-8000-000000000011'
      AND rr.status IN ('pending', 'running')),
  0,
  'the two-strikes cycle has no live run left'
);

-- Issue 2: the cycle reached `approved` but the issue's own status was never
-- written -- exactly what the sibling-pull-request gate and a stale
-- `accepted = false` verdict both leave behind.
UPDATE public.review_runs
   SET status = 'completed', finished_at = '2026-09-09T11:50:00Z'
 WHERE review_cycle_id = (SELECT id FROM public.review_cycles WHERE issue_id = 'e0000000-0000-4000-8000-000000000012');
UPDATE public.review_cycles
   SET state = 'approved'
 WHERE issue_id = 'e0000000-0000-4000-8000-000000000012';

-- Issue 4's run is genuinely in flight on a live host. `claim_review_run` is
-- a plain FIFO queue (priority desc, created_at asc) with no per-call
-- targeting, and issue 3's run is older -- outranking it is the only way to
-- pin which run ends up `running`.
UPDATE public.issues
   SET priority = 'urgent'
 WHERE id = 'e0000000-0000-4000-8000-000000000014';

SELECT public.claim_review_run(
  'e0000000-0000-4000-8000-000000000031',
  'stuck_test_user',
  '2026-09-09T11:59:30Z'::timestamptz
);

SELECT is(
  (SELECT rr.status FROM public.review_runs rr
     JOIN public.review_cycles rc ON rc.id = rr.review_cycle_id
    WHERE rc.issue_id = 'e0000000-0000-4000-8000-000000000014'),
  'running',
  'issue 4''s run is the one claimed'
);

-- Issue 6: a pending run stranded behind a pull request that is no longer
-- reviewable. `claim_review_run` can never pick it up, so it must not count
-- as a live review.
UPDATE public.issue_pull_requests
   SET state = 'closed'
 WHERE id = 'e0000000-0000-4000-8000-000000000026';

-- Backdate past the grace window, except issue 5, which stands in for a
-- transition that is still settling.
UPDATE public.issues
   SET updated_at = '2026-09-09T11:55:00Z'
 WHERE project_id = 'e0000000-0000-4000-8000-000000000001'
   AND id <> 'e0000000-0000-4000-8000-000000000015';
UPDATE public.issues
   SET updated_at = '2026-09-09T11:59:30Z'
 WHERE id = 'e0000000-0000-4000-8000-000000000015';

SELECT is(
  public.reconcile_stuck_reviewing_issues('2026-09-09T12:00:00Z'::timestamptz),
  3,
  'one pass reconciles the dead-ended, silently-approved, and stranded issues only'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000011'),
  'ready-for-review',
  'a dead-ended cycle stops claiming to be under review and surfaces for recovery'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000012'),
  'approved',
  'an approved cycle whose verdict never reached the issue converges to approved'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000013'),
  'reviewing',
  'an issue with a claimable pending run is left alone'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000014'),
  'reviewing',
  'an issue whose run is actively running is left alone'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000015'),
  'reviewing',
  'the grace window protects a transition that is still settling'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000016'),
  'cancelled',
  'a pending run no host can ever claim does not hold the issue in reviewing'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = 'e0000000-0000-4000-8000-000000000017'),
  'reviewing',
  'an issue Automatic Review never touched is left exactly as its owner set it'
);

SELECT is(
  (SELECT count(*)::integer FROM public.review_attempts ra
     JOIN public.review_cycles rc ON rc.id = ra.review_cycle_id
    WHERE rc.issue_id IN (
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000016'
    )),
  0,
  'reconciliation never fabricates a Review Attempt or a verdict'
);

SELECT is(
  (SELECT state FROM public.review_cycles WHERE issue_id = 'e0000000-0000-4000-8000-000000000011'),
  'active',
  'the cycle itself is untouched, so Retry review still has its remaining budget'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_events
    WHERE issue_id = 'e0000000-0000-4000-8000-000000000012'
      AND type = 'status_changed'
      AND payload->>'from' = 'reviewing'
      AND payload->>'to' = 'approved'),
  1,
  'the correction is visible on the issue timeline'
);

-- Idempotence: with every issue now consistent, a second pass is a no-op.
SELECT is(
  public.reconcile_stuck_reviewing_issues('2026-09-09T12:01:00Z'::timestamptz),
  0,
  'a second pass changes nothing'
);

SELECT * FROM finish();
ROLLBACK;
