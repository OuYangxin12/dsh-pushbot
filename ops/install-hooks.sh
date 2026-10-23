#!/usr/bin/env bash
# Install the repository's git hooks (CI gate before every commit).
set -euo pipefail
root=$(git rev-parse --show-toplevel)
mkdir -p "$root/.git/hooks"
install -m 755 "$root/ops/hooks/pre-commit" "$root/.git/hooks/pre-commit"
echo "installed .git/hooks/pre-commit"
