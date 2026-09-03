BEGIN;
SELECT plan(24);

INSERT INTO public.projects (id, user_id, name, repo, key)
VALUES
  ('10000000-0000-4000-8000-000000000601', 'user_alpha', 'Alpha', 'gentic/alpha-archive', 'AAR'),
  ('10000000-0000-4000-8000-000000000602', 'user_beta', 'Beta', 'gentic/beta-archive', 'BAR');

INSERT INTO public.issues (id, project_id, title, body, status, number)
VALUES
  ('20000000-0000-4000-8000-000000000601', '10000000-0000-4000-8000-000000000601', 'Draft issue', 'Prompt', 'draft', 1),
  ('20000000-0000-4000-8000-000000000602', '10000000-0000-4000-8000-000000000601', 'Done issue', 'Prompt', 'completed', 2),
  ('20000000-0000-4000-8000-000000000603', '10000000-0000-4000-8000-000000000601', 'In progress issue', 'Prompt', 'in-progress', 3);

-- Zero assignments: archiving still succeeds and reports zero affected issues.
INSERT INTO public.labels (id, user_id, name, color)
VALUES ('30000000-0000-4000-8000-000000000601', 'user_alpha', 'Unused', '#2563EB');

SELECT is(
  (SELECT affected_issue_count FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000601', '2026-08-05T10:00:00Z')),
  0,
  'archiving an unused label reports zero affected issues'
);
SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000601'),
  'archived',
  'archiving marks the label archived'
);
SELECT is(
  (SELECT archived_at FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000601'),
  '2026-08-05T10:00:00Z'::timestamptz,
  'archiving stamps archived_at with the provided timestamp'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_events),
  0,
  'archiving an unused label writes no dangling event rows'
);

-- One assignment across multiple statuses: archiving removes it and writes
-- exactly one grouped removal event on the affected issue.
INSERT INTO public.labels (id, user_id, name, color)
VALUES ('30000000-0000-4000-8000-000000000602', 'user_alpha', 'Single use', '#1D4ED8');
INSERT INTO public.issue_labels (issue_id, label_id)
VALUES ('20000000-0000-4000-8000-000000000601', '30000000-0000-4000-8000-000000000602');

SELECT is(
  (SELECT affected_issue_count FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000602', '2026-08-05T10:01:00Z')),
  1,
  'archiving a label with one assignment reports one affected issue'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_labels WHERE label_id = '30000000-0000-4000-8000-000000000602'),
  0,
  'archiving removes the sole assignment'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE issue_id = '20000000-0000-4000-8000-000000000601'
       AND type = 'labels_changed'
  ),
  1,
  'archiving writes exactly one labels_changed event for the affected issue'
);
SELECT is(
  (
    SELECT payload
      FROM public.issue_events
     WHERE issue_id = '20000000-0000-4000-8000-000000000601'
       AND type = 'labels_changed'
  ),
  jsonb_build_object(
    'added', '[]'::jsonb,
    'removed', jsonb_build_array(
      jsonb_build_object('id', '30000000-0000-4000-8000-000000000602', 'name', 'Single use', 'color', '#1D4ED8')
    )
  ),
  'the removal event snapshot carries the archived label id, name, and color'
);

-- High assignment count: archiving removes every assignment regardless of
-- issue status and writes one grouped event per affected issue. The three
-- seeded issues cover the status spread; the generated ones push the count
-- well past anything a per-row loop would handle comfortably.
INSERT INTO public.issues (id, project_id, title, body, status, number)
SELECT
  ('20000000-0000-4000-8000-' || lpad((700 + value)::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000601',
  'Bulk issue ' || value,
  'Prompt',
  (ARRAY['draft', 'todo', 'in-progress', 'completed', 'run-failed'])[1 + (value % 5)],
  100 + value
  FROM generate_series(1, 250) AS value;

INSERT INTO public.labels (id, user_id, name, color)
VALUES ('30000000-0000-4000-8000-000000000603', 'user_alpha', 'Popular', '#059669');
INSERT INTO public.issue_labels (issue_id, label_id)
SELECT issues.id, '30000000-0000-4000-8000-000000000603'
  FROM public.issues
 WHERE issues.project_id = '10000000-0000-4000-8000-000000000601';

SELECT is(
  (SELECT affected_issue_count FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000603', '2026-08-05T10:02:00Z')),
  253,
  'archiving a widely-assigned label reports every affected issue, across statuses'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_labels WHERE label_id = '30000000-0000-4000-8000-000000000603'),
  0,
  'archiving removes every assignment regardless of count'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE type = 'labels_changed'
       AND payload -> 'removed' @> jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000603'))
  ),
  253,
  'archiving writes one grouped removal event per affected issue'
);
SELECT is(
  (
    SELECT count(DISTINCT issue_id)::integer
      FROM public.issue_events
     WHERE type = 'labels_changed'
       AND payload -> 'removed' @> jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000603'))
  ),
  253,
  'the grouped removal events are one per issue, not one per assignment'
);

-- Ownership: archiving never reveals or affects another account's label.
SELECT is_empty(
  $$
    SELECT id FROM public.archive_label('user_beta', '30000000-0000-4000-8000-000000000601', '2026-08-05T10:03:00Z')
  $$,
  'archiving does not reveal or act on another account''s label'
);
SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000601'),
  'archived',
  'a cross-account archive attempt leaves the original label state untouched'
);

-- Idempotency / no restore: archiving an already-archived label is rejected.
SELECT is_empty(
  $$
    SELECT id FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000601', '2026-08-05T10:04:00Z')
  $$,
  'archiving an already-archived label is a no-op that reports not found'
);

-- Nonexistent label id.
SELECT is_empty(
  $$
    SELECT id FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000699', '2026-08-05T10:05:00Z')
  $$,
  'archiving a nonexistent label id reports not found'
);

-- Active-limit accounting: an archived label frees a slot in the 100-active
-- limit immediately (already covered structurally by 20260804120000, this
-- exercises it end to end through the RPC).
INSERT INTO public.labels (user_id, name, color)
SELECT 'limit_user_archive', 'Cap ' || value, '#2563EB'
  FROM generate_series(1, 100) AS value;

SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('limit_user_archive', 'Too many', '#0F766E') $$,
  '23514',
  null,
  'a fresh account at the cap cannot add another active label'
);

SELECT ok(
  (
    SELECT affected_issue_count
      FROM public.archive_label(
        'limit_user_archive',
        (SELECT id FROM public.labels WHERE user_id = 'limit_user_archive' AND name = 'Cap 1'),
        '2026-08-05T10:06:00Z'
      )
  ) IS NOT NULL,
  'archiving one label at the cap succeeds'
);

SELECT lives_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('limit_user_archive', 'Now fits', '#0F766E') $$,
  'archiving a label immediately frees a slot in the 100-active-label limit'
);

-- Rollback: work performed by archive_label does not survive when the
-- enclosing transaction is rolled back, demonstrating the whole operation
-- commits or nothing does (supabase-js issues each RPC call as its own
-- transaction, so a savepoint models the same all-or-nothing boundary).
INSERT INTO public.labels (id, user_id, name, color)
VALUES ('30000000-0000-4000-8000-000000000604', 'user_alpha', 'Rollback me', '#EA580C');
INSERT INTO public.issue_labels (issue_id, label_id)
VALUES ('20000000-0000-4000-8000-000000000601', '30000000-0000-4000-8000-000000000604');

SAVEPOINT before_archive;
SELECT * FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000604', '2026-08-05T10:07:00Z');
ROLLBACK TO SAVEPOINT before_archive;

SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000604'),
  'active',
  'rollback undoes the archived state change'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_labels
     WHERE label_id = '30000000-0000-4000-8000-000000000604'
  ),
  1,
  'rollback restores the removed assignment'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE issue_id = '20000000-0000-4000-8000-000000000601'
       AND type = 'labels_changed'
       AND payload -> 'removed' @> jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000604'))
  ),
  0,
  'rollback undoes the grouped removal event'
);

-- Privileges: only service_role can invoke this RPC directly, matching the
-- host lifecycle RPC pattern (this app calls it from trusted server code
-- with an explicit p_user_id ownership check rather than table RLS).
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.archive_label(text, uuid, timestamptz)',
    'EXECUTE'
  ),
  'authenticated role cannot directly invoke archive_label'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.archive_label(text, uuid, timestamptz)',
    'EXECUTE'
  ),
  'service role can invoke archive_label'
);

SELECT * FROM finish();
ROLLBACK;
