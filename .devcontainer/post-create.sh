#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$repo_root" ]] || { echo "error: run from a Hestia checkout" >&2; exit 1; }

HARA_REPOSITORY="https://github.com/hara-lang/hara.git"
HARA_REVISION="a190f7df995f51a60fad7348ac1feafaf53468e3"
HARA_CHECKOUT="$repo_root/.local/hara.lang"

fail() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }

persist_local_bin() {
  local line='export PATH="$HOME/.local/bin:$PATH"'
  mkdir -p "$HOME/.local/bin"
  touch "$HOME/.bashrc"
  grep -Fqx "$line" "$HOME/.bashrc" || printf '\n%s\n' "$line" >> "$HOME/.bashrc"
  export PATH="$HOME/.local/bin:$PATH"
}

select_node() {
  local major="$1"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm install "$major"
    nvm use "$major"
  fi
  need node; need npm
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == "$major" ]] \
    || fail "Node $major is required; found $(node --version)"
}

select_java() {
  local candidate="/usr/lib/jvm/java-17-openjdk-amd64"
  if [[ -x "$candidate/bin/java" ]]; then
    export JAVA_HOME="$candidate"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  need java
  java -version 2>&1 | head -n 1 | grep -Eq '(version "17[.]|openjdk 17[.])' \
    || fail "JDK 17 is required"
}

ensure_rust() {
  need rustup
  rustup toolchain install 1.88.0 --profile minimal
  need cargo
}

ensure_lein() {
  if ! command -v lein >/dev/null 2>&1; then
    curl -fsSL https://raw.githubusercontent.com/technomancy/leiningen/2.11.2/bin/lein \
      -o "$HOME/.local/bin/lein"
    chmod 0755 "$HOME/.local/bin/lein"
  fi
  lein version >/dev/null
}

ensure_checkout() {
  local repository="$1" revision="$2" checkout="$3"
  if [[ -e "$checkout" ]]; then
    [[ -d "$checkout/.git" ]] || fail "$checkout exists but is not a Git checkout"
    [[ -z "$(git -C "$checkout" status --porcelain --untracked-files=all)" ]] \
      || fail "dependency checkout is dirty: $checkout"
    local actual
    actual="$(git -C "$checkout" rev-parse HEAD)"
    [[ "$actual" == "$revision" ]] \
      || fail "dependency revision mismatch at $checkout (expected $revision, found $actual); refusing to reset it"
    return
  fi
  mkdir -p "$(dirname "$checkout")"
  local temporary="${checkout}.tmp.$$"
  rm -rf "$temporary"
  git clone --filter=blob:none --no-checkout "$repository" "$temporary"
  git -C "$temporary" fetch --depth 1 origin "$revision"
  git -C "$temporary" checkout --detach "$revision"
  mv "$temporary" "$checkout"
}

install_node_tree() {
  local directory="$1"
  [[ -f "$directory/package.json" ]] || fail "missing package.json: $directory"
  [[ -f "$directory/package-lock.json" ]] || fail "missing package-lock.json: $directory"
  npm ci --prefix "$directory"
}

fetch_rust_graph() {
  local manifest="$1" directory
  directory="$(dirname "$manifest")"
  if [[ -f "$directory/Cargo.lock" ]]; then
    cargo +1.88.0 fetch --locked --manifest-path "$manifest"
  else
    cargo +1.88.0 fetch --manifest-path "$manifest"
  fi
}

print_version() {
  local label="$1"; shift
  printf '%-14s ' "$label:"
  "$@" --version 2>&1 | head -n 1 || true
}

persist_local_bin
select_node 24
select_java
ensure_rust
ensure_lein
need git; need python3; need psql

ensure_checkout "$HARA_REPOSITORY" "$HARA_REVISION" "$HARA_CHECKOUT"
hara_manifest="$HARA_CHECKOUT/core/rust/Cargo.toml"
[[ -f "$hara_manifest" ]] || fail "pinned Hara checkout has no core/rust/Cargo.toml"
cargo +1.88.0 fetch --locked --manifest-path "$hara_manifest"
cargo +1.88.0 build --locked --release --manifest-path "$hara_manifest" --bin hara --bin hara-test
install -m 0755 "$HARA_CHECKOUT/core/rust/target/release/hara" "$HOME/.local/bin/hara"
install -m 0755 "$HARA_CHECKOUT/core/rust/target/release/hara-test" "$HOME/.local/bin/hara-test"

while IFS= read -r -d '' manifest; do
  fetch_rust_graph "$manifest"
done < <(find "$repo_root" \
  -path "$repo_root/.local" -prune -o \
  -path '*/node_modules' -prune -o \
  -path '*/target' -prune -o \
  -name Cargo.toml -print0)

while IFS= read -r -d '' project; do
  (cd "$(dirname "$project")" && lein deps)
done < <(find "$repo_root" "$HARA_CHECKOUT" \
  -path '*/.git' -prune -o -name project.clj -print0)

for package_dir in \
  "$repo_root/browser" \
  "$repo_root/services/signaling" \
  "$repo_root/services/agent-gateway" \
  "$repo_root/cloudflare/signaling" \
  "$repo_root/site"
do
  install_node_tree "$package_dir"
done
(
  cd "$repo_root/browser"
  npx playwright install chromium firefox
)

[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]] \
  || fail "setup changed the Hestia working tree"

printf '\nHestia development environment ready.\n'
print_version "Java" java
print_version "Leiningen" lein
print_version "Node" node
print_version "npm" npm
print_version "Rust" rustc +1.88.0
print_version "Cargo" cargo +1.88.0
print_version "PostgreSQL" psql
print_version "Hara" hara
print_version "hara-test" hara-test
printf 'Hara revision: %s\n' "$(git -C "$HARA_CHECKOUT" rev-parse HEAD)"
cat <<'CHECKS'

Available checks (dependencies are prepared for offline execution):
  make boundary-check
  make controller-check
  make controller-test
  npm test --prefix browser
  npm test --prefix services/signaling
  npm test --prefix services/agent-gateway
  npm run check --prefix cloudflare/signaling
  npm run test:e2e --prefix browser
  npm run build --prefix site

Optional Docker integration (only when a daemon is available):
  docker info
  bash scripts/test-agent-record-verification
CHECKS
