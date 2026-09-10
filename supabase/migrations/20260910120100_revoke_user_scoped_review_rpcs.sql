-- `start_fresh_implementation`, `continue_with_human_review`, and
-- `retry_review_run` are SECURITY DEFINER, so they bypass RLS, and they
-- authorize on a `p_user_id text` argument rather than on the verified JWT:
--
--   where i.id = p_issue_id and p.user_id = p_user_id
--
-- Held by `authenticated`, that grant makes the argument the entire access
-- check — the browser holds an `authenticated` PostgREST client, so the
-- caller could pass any Clerk user id and act on that account's Issue or
-- review cycle (superseding a live implementation session, or marking a
-- review cycle approved). What kept it from being exploitable is that the
-- second argument is an unguessable v4 UUID no code path exposes outside the
-- owner's account — obscurity, not authorization.
--
-- Every sibling lifecycle RPC written to this shape (`ban_host`,
-- `delete_host`, `rename_host`, `archive_label`, `claim_review_run`) is
-- already service_role only for exactly this reason. These three were the
-- outliers; the Server Actions that call them now use the service client and
-- pass a Clerk-derived id.
revoke execute on function public.start_fresh_implementation(
  text, uuid, timestamptz
) from public, authenticated;

revoke execute on function public.continue_with_human_review(
  text, uuid, timestamptz
) from public, authenticated;

revoke execute on function public.retry_review_run(
  text, uuid, timestamptz
) from public, authenticated;

grant execute on function public.start_fresh_implementation(
  text, uuid, timestamptz
) to service_role;

grant execute on function public.continue_with_human_review(
  text, uuid, timestamptz
) to service_role;

grant execute on function public.retry_review_run(
  text, uuid, timestamptz
) to service_role;
