#!/usr/bin/env bash
# Build an immutable version directory under versions/vNNN (CI runs first).
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
PKG="$ROOT/app/packages/dsh-pushbot-app"
VERSIONS="$ROOT/versions"

bash "$ROOT/ops/ci.sh" >/dev/null

LAST=$(ls -1 "$VERSIONS" 2>/dev/null | grep -E '^v[0-9]{3}$' | sed 's/^v//' | sort -n | tail -1 || true)
N=$((10#${LAST:-0} + 1))
NAME=$(printf 'v%03d' "$N")
DIR="$VERSIONS/$NAME"
rm -rf "$DIR"
mkdir -p "$DIR/packages"
cp -R "$PKG" "$DIR/packages/dsh-pushbot-app"
rm -rf "$DIR/packages/dsh-pushbot-app/test"

NAME_DIR="$DIR" BUILD_N="$N" PKG_SRC="$PKG" ROOT_DIR="$ROOT" node --input-type=module -e '
import { readFile, readdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import path from "node:path"
const dir = process.env.NAME_DIR
const root = process.env.ROOT_DIR
const pkgDir = path.join(dir, "packages/dsh-pushbot-app")
const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"))
const files = {}
for (const name of (await readdir(path.join(pkgDir, "lib"))).sort()) {
  const rel = "lib/" + name
  const buf = await readFile(path.join(pkgDir, rel))
  files[rel] = createHash("sha256").update(buf).digest("hex")
}
let gitSha = null, dirty = false
try {
  gitSha = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
  dirty = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim().length > 0
} catch {}
const manifest = { build: Number(process.env.BUILD_N), package: pkg.name, version: pkg.version, gitSha, dirty, builtAt: new Date().toISOString(), files }
await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(JSON.stringify(manifest))
'
echo "built $DIR"
