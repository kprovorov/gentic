#!/usr/bin/env bash
# Regenerates packaging/homebrew-gentic/Formula/gentic.rb from a published
# gentic-v<version> GitHub release: fills in the version, download URLs,
# and sha256s from that release's checksums.txt (see
# .github/workflows/gentic-release.yml). Run after each release, commit the
# result, then copy Formula/gentic.rb into the real kprovorov/homebrew-gentic
# tap repo and push (see packaging/homebrew-gentic/README.md) — this script
# does not publish to the tap repo itself.
set -euo pipefail

VERSION="${1:?usage: bump-homebrew-formula.sh X.Y.Z}"
REPO="kprovorov/gentic"
TAG="gentic-v${VERSION}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FORMULA="$REPO_ROOT/packaging/homebrew-gentic/Formula/gentic.rb"

CHECKSUMS_URL="https://github.com/$REPO/releases/download/$TAG/checksums.txt"
CHECKSUMS="$(curl -sSL "$CHECKSUMS_URL")"
if [ -z "$CHECKSUMS" ]; then
  echo "error: could not fetch $CHECKSUMS_URL — has $TAG been released yet?" >&2
  exit 1
fi

sha_for() {
  local line
  line="$(echo "$CHECKSUMS" | grep "gentic-$1.tar.gz")"
  if [ -z "$line" ]; then
    echo "error: no checksum for gentic-$1.tar.gz in $TAG's checksums.txt" >&2
    exit 1
  fi
  echo "$line" | awk '{print $1}'
}

DARWIN_ARM64="$(sha_for bun-darwin-arm64)"
DARWIN_X64="$(sha_for bun-darwin-x64)"
LINUX_ARM64="$(sha_for bun-linux-arm64)"
LINUX_X64="$(sha_for bun-linux-x64)"

cat > "$FORMULA" <<EOF
class Gentic < Formula
  desc "Gentic agent: runs Claude Code or Codex over ACP for queued issues"
  homepage "https://github.com/$REPO"
  version "$VERSION"

  on_macos do
    on_arm do
      url "https://github.com/$REPO/releases/download/$TAG/gentic-bun-darwin-arm64.tar.gz"
      sha256 "$DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/$REPO/releases/download/$TAG/gentic-bun-darwin-x64.tar.gz"
      sha256 "$DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/$REPO/releases/download/$TAG/gentic-bun-linux-arm64.tar.gz"
      sha256 "$LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/$REPO/releases/download/$TAG/gentic-bun-linux-x64.tar.gz"
      sha256 "$LINUX_X64"
    end
  end

  def install
    libexec.install "gentic", "vendor"
    bin.install_symlink libexec/"gentic"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gentic --version")
  end
end
EOF

echo "Wrote $FORMULA for $VERSION"
echo "Next: copy Formula/gentic.rb into kprovorov/homebrew-gentic and push."
