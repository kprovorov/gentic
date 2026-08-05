# 2. Label archival and implicit restoration

Date: 2026-08-05

## Status

Accepted

## Context

[ADR 0001](0001-account-scoped-labels.md) establishes account-scoped Labels with
case-insensitive names that are unique across an Account. That raises a lifecycle
question: what happens when a user is done with a Label?

Permanent deletion is lossy. Issue timelines record when Labels were added and
removed, and those historical entries reference the Label's identity, name, and
color. Hard-deleting a Label would either orphan or rewrite that history. It
would also free the name for reuse in a way that silently merges two distinct
classifications under one identity over time.

At the same time, users must be able to retire vocabulary so the active catalog
stays curated and stays under the 100-active-Label cap, and they must be able to
bring a name back without hunting through a separate "archived" management
surface.

## Decision

Removing a Label **archives** it rather than deleting it, and re-creating the
same name **restores** the original Label. Neither operation restores former
assignments.

**Archival** is a single atomic transaction (a `SECURITY DEFINER`
`archive_label` RPC, so it works regardless of assignment count and is not
subject to the 100-issue bulk limit):

1. Snapshot and emit one grouped `labels_changed` removal event on every issue
   that currently carries the Label — including when that count is zero — so the
   change stays traceable on each issue's timeline.
2. Delete every current `issue_labels` assignment for the Label.
3. Flip the Label to `state = 'archived'` and stamp `archived_at`.

An archived Label disappears from `list_labels`, autocomplete, filtering,
assignment, and Settings management, and stops counting toward the 100-active
cap. Its `name_key` is still reserved by the Account-wide uniqueness constraint,
and historical timeline entries keep rendering it (with archived styling).

**Restoration is create-by-name only.** There is no separate restore action or
MCP tool, and no archived-Label browser:

- Creating a Label whose trimmed, case-insensitive name matches an **active**
  Label is rejected ("Label name already exists.").
- Creating a Label whose name matches an **archived** Label revives that same row
  in place — same `id`, same stored display casing, same color. Any casing or
  color supplied on the create call is **ignored**; the restored Label keeps its
  prior identity. The web flow triggers this only after the user confirms
  creation, so typing in a search box never mutates data. The MCP `create_label`
  tool reports `restored: true` in this case.
- Restoration **respects the 100-active-Label limit** — a pre-check plus the
  active-limit trigger both fire, so restoring into a full catalog fails
  atomically.
- Restoration does **not** re-attach the assignments that archival removed. The
  Label comes back empty.

Stale attempts to assign or filter by an archived Label ID are rejected as
not-found/invalid rather than treated as a valid empty result, so a race that
archives a Label out from under an in-flight assignment surfaces the archive
side effect instead of hiding it.

## Consequences

- History is preserved. Old `labels_changed` events keep their immutable
  name/color snapshots; the Label's **current** archive state (not the snapshot)
  drives gray strikethrough rendering, and restoring the Label returns those old
  events to normal styling.
- Reserved names cannot be reused to create a second, colliding identity, and a
  restored Label is provably the same Label — which is why MCP mutations key off
  the stable `id` rather than the renameable display name.
- Users get a curated active catalog and a one-step "bring it back" flow without
  a dedicated archive UI, at the cost of not being able to permanently delete a
  Label or to recover former assignments on restore. Both are accepted
  trade-offs and are out of scope.
- Rename and recolor edit the shared definition in place and deliberately emit
  **no** issue events, so changing a Label's presentation does not flood the
  timelines of every issue that carries it.
