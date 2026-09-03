BEGIN;
SELECT plan(15);

INSERT INTO public.hosts (
  id, user_id, display_name, credential_hash, setup_state, last_seen_at,
  provider_capabilities
) VALUES (
  '09000000-0000-4000-8000-610000000001',
  'user_convergence',
  'Convergence Host',
  repeat('a', 64),
  'ready',
  now(),
  '{"providers":{}}'::jsonb
);

INSERT INTO public.projects (id, user_id, name, repo, key) VALUES (
  '19000000-0000-4000-8000-610000000001',
  'user_convergence',
  'Convergence Project',
  'acme/convergence',
  'CVG'
);

INSERT INTO public.issues (
  id, project_id, title, body, status, number, active_host_id, active_run_id
) VALUES
  (
    '29000000-0000-4000-8000-610000000001',
    '19000000-0000-4000-8000-610000000001',
    'Webhook first', 'Body', 'in-progress', 1,
    '09000000-0000-4000-8000-610000000001',
    '39000000-0000-4000-8000-610000000001'
  ),
  (
    '29000000-0000-4000-8000-610000000002',
    '19000000-0000-4000-8000-610000000001',
    'Finish first', 'Body', 'in-progress', 2,
    '09000000-0000-4000-8000-610000000001',
    '39000000-0000-4000-8000-610000000002'
  ),
  (
    '29000000-0000-4000-8000-610000000003',
    '19000000-0000-4000-8000-610000000001',
    'Queued lease', 'Body', 'queued', 3,
    '09000000-0000-4000-8000-610000000001',
    '39000000-0000-4000-8000-610000000003'
  ),
  (
    '29000000-0000-4000-8000-610000000004',
    '19000000-0000-4000-8000-610000000001',
    'Draft then ready', 'Body', 'in-progress', 4,
    '09000000-0000-4000-8000-610000000001',
    '39000000-0000-4000-8000-610000000004'
  );

-- Webhook before finish: persist reviewable state without disturbing the
-- active run, then let completion derive the aggregate after releasing it.
SELECT public.associate_pull_request_from_webhook(
  '29000000-0000-4000-8000-610000000001',
  'https://github.com/acme/convergence/pull/1',
  'open', true, 'head-1'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/convergence/pull/1',
  p_ci_state => 'success',
  p_review_decision => 'changes_requested'
);

SELECT is(
  (SELECT status FROM public.issues WHERE number = 1),
  'in-progress',
  'a webhook leaves an in-progress run status unchanged'
);
SELECT is(
  (SELECT active_run_id FROM public.issues WHERE number = 1),
  '39000000-0000-4000-8000-610000000001'::uuid,
  'a webhook leaves the in-progress run lease intact'
);

CREATE TEMP TABLE webhook_first_finish AS
SELECT * FROM public.finish_issue_run_if_no_pending(
  '29000000-0000-4000-8000-610000000001',
  '39000000-0000-4000-8000-610000000001',
  'waiting-for-input',
  now()
);

SELECT is((SELECT finished FROM webhook_first_finish), true, 'webhook-first completion succeeds');
SELECT is((SELECT status FROM webhook_first_finish), 'changes-requested', 'completion returns the associated PR aggregate');

-- Finish before webhook: completion may land waiting, then the later signed
-- delivery advances it to the identical aggregate state.
CREATE TEMP TABLE finish_first_completion AS
SELECT * FROM public.finish_issue_run_if_no_pending(
  '29000000-0000-4000-8000-610000000002',
  '39000000-0000-4000-8000-610000000002',
  'waiting-for-input',
  now()
);

SELECT is((SELECT status FROM finish_first_completion), 'waiting-for-input', 'a run with no reviewable association may finish waiting');

SELECT public.associate_pull_request_from_webhook(
  '29000000-0000-4000-8000-610000000002',
  'https://github.com/acme/convergence/pull/2',
  'open', true, 'head-2'
);
SELECT public.apply_pull_request_delivery_state(
  'https://github.com/acme/convergence/pull/2',
  p_ci_state => 'success',
  p_review_decision => 'changes_requested'
);

SELECT is(
  (SELECT status FROM public.issues WHERE number = 2),
  (SELECT status FROM public.issues WHERE number = 1),
  'both webhook and finish event orders converge on the same status'
);
SELECT is(
  (SELECT active_run_id FROM public.issues WHERE number = 2),
  null,
  'finish-first convergence leaves the run lease released'
);
SELECT is(
  (SELECT active_host_id FROM public.issues WHERE number = 2),
  null,
  'finish-first convergence releases host capacity'
);
SELECT is(
  (SELECT active_run_id FROM public.issues WHERE number = 1),
  null,
  'webhook-first convergence leaves the run lease released'
);
SELECT is(
  (SELECT active_host_id FROM public.issues WHERE number = 1),
  null,
  'webhook-first convergence releases host capacity'
);

-- Queued is also a leased status and must receive the same protection.
SELECT public.associate_pull_request_from_webhook(
  '29000000-0000-4000-8000-610000000003',
  'https://github.com/acme/convergence/pull/3',
  'open', true, 'head-3'
);
SELECT is((SELECT status FROM public.issues WHERE number = 3), 'queued', 'a webhook leaves a queued run unchanged');
SELECT is(
  (SELECT active_run_id FROM public.issues WHERE number = 3),
  '39000000-0000-4000-8000-610000000003'::uuid,
  'a webhook leaves the queued run lease intact'
);

-- A draft association contributes no aggregate state at completion. A later
-- ready-for-review webhook for the same sticky association may advance it.
SELECT public.associate_pull_request_from_webhook(
  '29000000-0000-4000-8000-610000000004',
  'https://github.com/acme/convergence/pull/4',
  'draft', false, 'head-4'
);
SELECT public.finish_issue_run_if_no_pending(
  '29000000-0000-4000-8000-610000000004',
  '39000000-0000-4000-8000-610000000004',
  'waiting-for-input',
  now()
);
SELECT is((SELECT status FROM public.issues WHERE number = 4), 'waiting-for-input', 'a draft-only association leaves completion waiting');

SELECT public.associate_pull_request_from_webhook(
  '29000000-0000-4000-8000-610000000004',
  'https://github.com/acme/convergence/pull/4',
  'open', true, 'head-4'
);
SELECT is((SELECT status FROM public.issues WHERE number = 4), 'ready-for-review', 'a later reviewable webhook advances the waiting issue');

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests WHERE issue_id IN (
    '29000000-0000-4000-8000-610000000001',
    '29000000-0000-4000-8000-610000000002',
    '29000000-0000-4000-8000-610000000003',
    '29000000-0000-4000-8000-610000000004'
  )),
  4,
  'retries and both event orders keep one sticky association per PR'
);

SELECT * FROM finish();
ROLLBACK;
