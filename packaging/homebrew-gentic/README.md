# homebrew-gentic (tap stub)

This directory is a staging copy of the `kprovorov/homebrew-gentic` Homebrew
tap. It is **not** a real tap yet — Homebrew requires the formula to live in
its own repository named `homebrew-<name>` for `brew tap kprovorov/gentic` /
`brew install kprovorov/gentic/gentic` to work.

## One-time setup (human step)

1. Create a new, empty GitHub repository at `kprovorov/homebrew-gentic`.
2. Copy this directory's contents (`Formula/gentic.rb`) into that repo's
   root, so the repo layout is:
   ```
   homebrew-gentic/
     Formula/
       gentic.rb
   ```
3. Push to `main`.

After that, `brew tap kprovorov/gentic` (Homebrew infers the tap URL from
the `homebrew-` prefix) and `brew install kprovorov/gentic/gentic` work
against whatever `Formula/gentic.rb` currently contains.

## Regenerating the formula after a release

Run, from the repo root:

```bash
./apps/gentic/scripts/bump-homebrew-formula.sh X.Y.Z
```

This fetches `checksums.txt` from the `gentic-vX.Y.Z` GitHub release (see
`.github/workflows/gentic-release.yml`) and rewrites
`packaging/homebrew-gentic/Formula/gentic.rb` in place with the new
version, download URLs, and sha256s. Commit the result here, then copy it
into the real tap repo (step 2 above) and push — this script does not push
to the tap repo itself.

## Local test (before publishing)

```bash
brew install --build-from-source packaging/homebrew-gentic/Formula/gentic.rb
gentic --version
gentic run   # against a test GENTIC_API_KEY / GENTIC_API_URL
```

The formula installs the binary and its `vendor/` sidecar (see
`apps/gentic/src/session.ts`) into `libexec`, then symlinks `bin/gentic` to
it. This matters because Homebrew's `bin` is itself a symlink into the
Cellar: `process.execPath` resolves through symlinks to the real file, so
`dirname(execPath)` lands in `libexec` and finds `libexec/vendor` right next
to it — no `GENTIC_VENDOR_DIR` override needed for the Homebrew case
specifically. That env var still exists in `resolveAgentEntry`
(`src/session.ts`) as an escape hatch if a future formula change stops
matching this layout.

This was verified end-to-end, not just reasoned about: a local `local/gentic`
tap was created with `brew tap-new`, this formula (pointed at a `file://`
build of `gentic-bun-linux-x64.tar.gz`) was installed with
`brew install --build-from-source`, and the installed, symlinked
`gentic --version` and `gentic run` (against a fake API key/URL, to confirm
it starts and polls rather than crashing on sidecar resolution) both worked
against the real Cellar/`bin`-symlink layout.
