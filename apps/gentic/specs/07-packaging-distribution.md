# Packaging & distribution (Homebrew, apt)

## Context

### Prerequisites

This task assumes `apps/gentic` already has a build script that compiles
the CLI into a standalone, dependency-free per-platform executable (e.g.
via `bun build --compile`), producing for each target (at least
`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`) an output
directory containing:

- the compiled `gentic` binary
- a `vendor/claude-agent-acp/` sidecar directory next to it — the
  ACP agent binary that `gentic` spawns as a child process at runtime,
  which a naive compile step won't bundle automatically (it's resolved via
  `require.resolve` + `spawn`, not `import`ed, so it has to ship
  alongside the binary as a plain file tree)

If this build tooling doesn't exist yet, you'll need to add it before this
task's release workflow has anything to package — check
`apps/gentic/package.json` and `apps/gentic/src/session.ts` for how the
ACP agent child process is spawned (`spawn(process.execPath, [AGENT_ENTRY],
...)` where `AGENT_ENTRY` is currently resolved via
`require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js")`)
before assuming a particular sidecar layout — read whatever the actual
runtime resolution logic is and match this task's packaging to it, not the
other way around.

Also useful if present, but not required for this task to proceed: a
persisted config file / login command and a service-management
(`start`/`stop`) command with a `--system` flag for installing a
system-wide (not per-user) service — a package-manager postinstall script
benefits from being able to call `gentic start --system`, but package what
exists and note the gap if those commands aren't there yet.

## Goal

`brew install kprovorov/gentic/gentic` and a downloadable/installable
`.deb` for apt-based systems, both wrapping the standalone binaries above.

## Part A — Release workflow (prerequisite for both)

Add a GitHub Actions workflow (`.github/workflows/gentic-release.yml` or
similar — check existing workflows in this repo for naming/style
conventions first) triggered on a tag push (e.g. `gentic-v*`) that:

1. Checks out, installs pnpm deps, installs Bun (or whatever the compile
   step actually requires).
2. Runs the standalone-binary build script for each target
   (`bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`
   — adjust to whatever target names the build script actually accepts).
3. Tars/zips each target's output directory (binary + `vendor/` sidecar
   together — they must ship as one unit) into `gentic-<target>.tar.gz`.
4. Computes a `sha256sum` for each archive (Homebrew formulas need this).
5. Creates a GitHub Release for the tag and uploads all archives + a
   `checksums.txt`.

## Part B — Homebrew tap

Create (or, if repo access doesn't allow a new separate repo from this
task, stub with clear instructions for a human to create) a tap repository
`kprovorov/homebrew-gentic` containing `Formula/gentic.rb`:

```ruby
class Gentic < Formula
  desc "Gentic agent: runs Claude Code over ACP for queued issues"
  homepage "https://github.com/kprovorov/gentic"
  version "X.Y.Z"

  on_macos do
    on_arm do
      url "https://github.com/kprovorov/gentic/releases/download/gentic-vX.Y.Z/gentic-bun-darwin-arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/kprovorov/gentic/releases/download/gentic-vX.Y.Z/gentic-bun-darwin-x64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/kprovorov/gentic/releases/download/gentic-vX.Y.Z/gentic-bun-linux-arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/kprovorov/gentic/releases/download/gentic-vX.Y.Z/gentic-bun-linux-x64.tar.gz"
      sha256 "..."
    end
  end

  def install
    bin.install "gentic"
    (libexec/"vendor").install "vendor/claude-agent-acp"
  end
end
```

Note the `vendor/` sidecar can't just live loose in `bin` — install it
under `libexec` and make sure the binary's sidecar-resolution logic can
still find it relative to the installed binary, or adjust the formula to
symlink/set an env var the CLI checks (e.g. `GENTIC_VENDOR_DIR`) if
relative-to-executable resolution doesn't survive Homebrew's `bin` being a
symlink into `Cellar`. **Verify this by actually installing via a local
tap and running `gentic run` — don't assume the path resolution "just
works" through Homebrew's symlink layout.**

Add a small script (e.g. `apps/gentic/scripts/bump-homebrew-formula.sh`) or
document the manual steps to regenerate the formula's version/URLs/shas
after each release — a human still triggers this, no need to fully
automate publishing to the tap repo in this task unless it's easy to wire
into Part A's workflow.

## Part C — apt / `.deb`

Use [`nfpm`](https://nfpm.goreleaser.com/) (no Go toolchain needed to use
it, ships as a static binary) to build a `.deb` from the Linux binaries.
Add `apps/gentic/nfpm.yaml`:

```yaml
name: gentic
arch: "${ARCH}" # amd64 / arm64, set per matrix leg
version: "${VERSION}"
maintainer: "..."
description: "Gentic agent: runs Claude Code over ACP for queued issues"
homepage: "https://github.com/kprovorov/gentic"
license: "..."
contents:
  - src: dist/${TARGET}/gentic
    dst: /usr/bin/gentic
  - src: dist/${TARGET}/vendor/claude-agent-acp
    dst: /usr/lib/gentic/vendor/claude-agent-acp
scripts:
  postinstall: ./scripts/deb-postinstall.sh
```

The vendor path differs from Homebrew's layout (`/usr/lib/gentic/vendor`
vs. relative-to-binary) — make sure the binary's sidecar-resolution logic
checks a short list of known locations (relative-to-executable, then
`/usr/lib/gentic/vendor/claude-agent-acp`, then the original
`require.resolve` fallback for dev/pnpm mode) rather than hardcoding one
path. This may mean going back to adjust that resolution function
wherever it lives (e.g. `src/session.ts`) — that's expected, flag it as a
follow-up patch in the PR description.

`scripts/deb-postinstall.sh` can optionally offer to install a system-wide
service unit (if a `gentic start --system`-style command exists) —
reasonable for a package manager install where the user expects a running
service, but make it interactive/skippable
(`DEBIAN_FRONTEND=noninteractive`-safe: default to *not* auto-starting on
install unless the user passes a flag or answers yes, since silently
starting a background service with no configured API key would just
crash-loop). If no such command exists yet, skip this and leave a comment
noting it as a follow-up.

### Distribution: what "apt install gentic" actually requires

Getting into the official Debian/Ubuntu archives is a slow review process
and out of scope. Two realistic options, cheapest first:

1. **MVP (do this)**: attach the `.deb` to the GitHub Release from Part A.
   Users run `sudo apt install ./gentic_X.Y.Z_amd64.deb` (installs the
   local file, still resolves dependencies via apt). Document this in
   `apps/gentic/readme.md`.
2. **Stretch (note as follow-up, don't block this task on it)**: host a
   real APT repository (e.g. via `aptly` or `reprepro`, published to
   GitHub Pages or a small object-storage bucket) so `apt install gentic`
   works after `add-apt-repository`/`echo ... > /etc/apt/sources.list.d/gentic.list`.
   This needs GPG-signing the repo metadata and a place to host it — scope
   as a separate task once the MVP is validated with real users.

## Acceptance criteria

- A tagged push produces a GitHub Release with 4 platform archives +
  checksums.
- `brew install --build-from-source <path-to-local-tap>/gentic.rb` (local
  tap test, doesn't require publishing to the real tap repo) installs a
  working `gentic` that can run `gentic --version` and `gentic run`
  against a test API key, sidecar path resolves correctly through
  Homebrew's Cellar/symlink layout.
- `sudo apt install ./gentic_*.deb` installs a working `/usr/bin/gentic`
  with the vendor directory present at the path the binary actually looks
  for it.
- `apps/gentic/readme.md` updated with install instructions for both
  package managers, replacing (or supplementing) the current "clone the
  repo, `pnpm install`" instructions.
