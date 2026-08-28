# 9. npm distribution for the worker CLI

Date: 2026-08-28

## Status

Accepted

## Context

GEN-431 replaces Homebrew with npm as the way users install the `gentic`
worker CLI.

Every existing channel is built from the same artifact: `bun build --compile`
produces a standalone executable plus vendored ACP sidecars — the
`claude-agent-acp` and `codex-acp` binaries and the native `claude` CLI that
`@anthropic-ai/claude-agent-sdk` ships as a per-platform optionalDependency.
Tarballs, `.deb`/`.rpm`/`.apk`, and the Homebrew keg are four different ways
to place that directory on disk with `vendor/` next to the binary, because
`apps/gentic/src/session.ts` locates the sidecars at
`dirname(process.execPath)/vendor`.

Homebrew cost a separate tap repo, a cross-repo push token, a rendered
formula, and a checksum-parsing script, and it only reached macOS and
Linuxbrew users. npm reaches every platform that runs Node.

There were two ways to publish to npm:

1. **Platform packages**, the esbuild/turbo pattern: a thin launcher package
   with `optionalDependencies` on `@gentic/cli-<os>-<arch>`, each carrying the
   compiled binary and its vendored sidecars. This keeps the zero-runtime-
   dependency property but ships hundreds of megabytes of prebuilt binaries
   per release across four packages, and requires npm and Node to install
   anyway.
2. **A plain Node package** whose dependencies are the ACP agents themselves.

`session.ts` already had the second path: when no `vendor/` sidecar exists it
falls back to `require.resolve` plus `node <entry>`, which is how the worker
runs from a source checkout. An npm install has a real `node_modules`, so that
fallback is not a degraded mode there — it is the normal mode, and it makes
the SDK's own `import.meta.resolve` lookup of the native `claude` binary work
for free, which is exactly what the vendoring in `scripts/build-binary.sh`
exists to work around.

The obstacle was that the CLI imports `@gentic/validators`, a workspace
package that is not on npm and whose `exports` point at raw `.ts` sources, so
the `tsc` output does not run off the workspace.

## Decision

**Publish a bundled, plain Node package; keep the compiled binaries for
machines without Node.**

`apps/gentic/scripts/build-npm-package.mjs` stages `apps/gentic/dist/npm`:
esbuild inlines workspace-only imports into a single `bin/gentic.js` (with a
shebang, which npm's symlinked bin entries require and the pnpm-shimmed
workspace build never needed), every registry dependency stays external, and a
generated manifest carries the published name and drops the workspace deps.
`apps/gentic` itself stays `private: true`, so the workspace package can never
be published by accident and the published manifest has exactly one source.

The registry name is **`gentic-cli`** — `gentic` on npm is an unrelated
package owned by someone else. The installed command is still `gentic`.

The `homebrew` job in `.github/workflows/release.yml` becomes an `npm` job
that publishes that directory with provenance, skipping versions already on
the registry. `packaging/homebrew-gentic/` is deleted. The tarball, `.deb`,
`.rpm`, `.apk`, and standalone-binary artifacts are untouched: they remain the
answer for a server with no Node.js, and they keep the vendored-sidecar layout
that the `dirname(execPath)/vendor` branch of `resolveAgentEntry` serves.

CI stages the package and runs the real bundle on every pull request, because
`pnpm build` (plain `tsc`) proves nothing about whether the published bundle
works.

## Consequences

- `npm install -g gentic-cli` works on any platform Node runs on, including
  ones with no prebuilt binary in the release matrix, and upgrades are
  `npm install -g gentic-cli@latest` rather than a tap update. The install
  path is stable across upgrades, so a service installed by `gentic start`
  keeps pointing at a valid entry point.
- The npm install requires Node.js 20.19+ on the worker machine, which the
  Homebrew install did not. That is the trade for not shipping four copies of
  the same vendored binaries through the registry every release; the tarball
  and Linux packages still cover Node-less hosts.
- The npm and binary channels now exercise *different* sidecar-resolution
  branches in `session.ts`. Both were already live (the fallback is the
  from-source path), but a change to either branch now affects a shipped
  channel and needs testing against both.
- Dependency resolution moves from build time to install time: an npm install
  gets whatever versions satisfy the published ranges, while the compiled
  binaries freeze the lockfile's. Publishing keeps using the same ranges the
  workspace declares, so this is the ordinary npm trade-off, not a new one.
- The one-time setup shifts from a `HOMEBREW_TAP_TOKEN` PAT to an `NPM_TOKEN`
  registry token (see `packaging/npm/README.md`). Until that secret exists,
  the `npm` job fails after the GitHub Release is already published; the job
  is idempotent, so re-running it once the secret is set completes the
  release.
