# Transcript Integrity and Retention

Issue transcripts are append-only for normal authenticated clients:

- Browser clients may insert `role = 'user'` messages for issues they own.
- Browser clients may not insert `assistant` or `system` messages.
- Browser clients may not update or delete rows in `public.messages`.
- Browser clients may not update protected issue run fields such as
  `session_id`, `run_started_at`, `run_finished_at`, `run_error`,
  `active_run_id`, `usage_limit_reset_at`, or `pr_url`.

Assistant and system messages are written through trusted agent API routes after
Clerk API-key verification and explicit issue ownership checks. The agent API
uses the Supabase service role only after those checks because service-role
queries bypass RLS.

Retrying an issue with a fresh agent run intentionally deletes the issue's
existing transcript and pull-request links. That operation is available only
through trusted server code after user ownership authorization, and it writes a
`transcript_audit_events` row with the actor, reason, source, previous run
metadata, and deleted message count before deleting transcript rows.

Deleting an issue still cascades to its messages, attachments metadata,
pull-request links, relations, and transcript audit rows through foreign-key
`on delete cascade` behavior. Attachment files are removed by the application
when users delete individual attachments; full issue deletion relies on database
metadata cascade and does not currently garbage-collect storage objects.
