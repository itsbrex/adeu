#!/bin/sh
# Point git at the version-controlled hooks in .githooks/.
# Safe to re-run. Works on macOS/Linux and Windows (Git Bash).
set -eu

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "✓ git hooks enabled (core.hooksPath = .githooks)"
echo "  Staged code will now be auto-formatted and checked on commit."
