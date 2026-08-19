# Hestia development environment

The Ubuntu 24.04 devcontainer and Codex cloud use the same idempotent setup.
Codex runs this script in its universal image and may run it again against a
cached environment; it does not build the repository Dockerfile.

## Setup and maintenance

```sh
bash .devcontainer/post-create.sh
```

Use these Codex environment values:

- **Setup script:** `bash .devcontainer/post-create.sh`
- **Maintenance script:** `bash .devcontainer/post-create.sh`
- **Agent internet access:** not required for the boundary, controller, Node, static, Cloudflare, browser, and site checks below after setup
- **Docker integration:** run from the devcontainer or Codespaces only when `docker info` succeeds

Setup materializes the exact extraction Hara revision under `.local/hara.lang`,
builds the extraction-era native `hara` CLI (which provides both `eval` and
`test`), prepares Lein and Cargo graphs, installs the five
locked Node package trees, and installs Playwright Chromium and Firefox. A
cached dependency checkout must be clean and exact; setup never resets it.

## Smoke test

```sh
hara --version
hara eval '(+ 19 23)'
```

## Representative offline checks

```sh
make boundary-check
make controller-check
make controller-test
npm test --prefix browser
npm test --prefix services/signaling
npm test --prefix services/agent-gateway
npm run check --prefix cloudflare/signaling
npm run test:e2e --prefix browser
npm run build --prefix site
```

## Optional Docker integration

```sh
docker info
bash scripts/test-agent-record-verification
```

Docker checks are unavailable in Codex cloud when no daemon is attached. Setup
does not run `scripts/hestia init`, create a database, start services, generate
keys, or create private state. Forwarded ports are `58080`, `58443`, `59999`,
`55432`, and Astro `4321`.
