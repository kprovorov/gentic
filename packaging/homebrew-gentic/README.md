# Homebrew packaging for the gentic worker

The gentic worker CLI is distributed through a Homebrew tap so users can
`brew install kprovorov/tap/gentic`. This directory owns the formula; the tap
repo ([`kprovorov/homebrew-tap`](https://github.com/kprovorov/homebrew-tap)) is
just the publish target.

## How it works

The `release` workflow (`.github/workflows/release.yml`) already builds a
single-file, dependency-free binary per platform with `bun build --compile`
plus the ACP agent sidecars, and uploads them to a GitHub Release as
(`X.Y.Z` is the release version):

- `gentic-X.Y.Z-darwin-arm64.tar.gz`
- `gentic-X.Y.Z-darwin-x64.tar.gz`
- `gentic-X.Y.Z-linux-arm64.tar.gz`
- `gentic-X.Y.Z-linux-x64.tar.gz`
- `.deb`/`.rpm`/`.apk` packages for each `linux-*` asset
- `checksums.txt`

The `homebrew` job then runs after the release is published and:

1. downloads `checksums.txt` from the new release,
2. renders `gentic.rb` from [`gentic.rb.tmpl`](./gentic.rb.tmpl) via
   [`render-formula.mjs`](./render-formula.mjs), filling in the version and the
   per-target `sha256`s, and
3. commits the result to `Formula/gentic.rb` in the tap repo.

`Formula/gentic.rb` in the tap is a **generated file** — the template here is
the source of truth. Edit the formula body (the `install`/`test` blocks, deps,
etc.) in `gentic.rb.tmpl`, not in the tap; the next release overwrites the tap
copy.

## Why the install block looks the way it does

The binary spawns the ACP agent sidecars from `vendor/<name>/<name>` resolved
relative to `dirname(process.execPath)` (see `apps/gentic/src/session.ts`), so
`vendor/` must sit next to the `gentic` binary. Homebrew's `bin/` is a symlink
farm into the keg, and `process.execPath` resolves through the symlink to the
real file, so the formula installs both `gentic` and `vendor/` into `libexec`
and symlinks `bin/gentic -> libexec/gentic`.

## One-time setup (required for the automation)

`GITHUB_TOKEN` cannot push to a different repo, so the `homebrew` job needs a
token with write access to the tap:

1. Create a **fine-grained personal access token** scoped to
   `kprovorov/homebrew-tap` with **Contents: Read and write**.
2. Add it to the `kprovorov/gentic` repo as an Actions secret named
   **`HOMEBREW_TAP_TOKEN`**
   (`gh secret set HOMEBREW_TAP_TOKEN --repo kprovorov/gentic`).

## Rendering the formula locally

```bash
gh release download vX.Y.Z --repo kprovorov/gentic --pattern checksums.txt
node packaging/homebrew-gentic/render-formula.mjs \
  --version X.Y.Z --checksums checksums.txt > Formula/gentic.rb
```

## Installing

```bash
brew tap kprovorov/tap
brew install gentic
# or in one shot:
brew install kprovorov/tap/gentic
```
