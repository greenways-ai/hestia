import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repository = new URL("../../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, repository), "utf8");
}

test("Compose mounts the environment signer as a secret, not an environment value", async () => {
  const compose = await source("compose.yaml");
  assert.match(compose, /agent-gateway:/);
  assert.match(compose, /HESTIA_ENVIRONMENT_SIGNING_KEY_FILE: \/run\/secrets\/environment-signing\.pem/);
  assert.match(compose, /source: hestia-environment-signing-key/);
  assert.match(compose, /file: \.\/\.hestia\/environment-signing\.pem/);
  assert.doesNotMatch(compose, /HESTIA_ENVIRONMENT_PRIVATE_KEY/);
  assert.doesNotMatch(compose, /environment-signing\.pem:\s*\|/);
});

test("Hoplite exposes the gateway only through the Hestia origin", async () => {
  const nginx = await source("hoplite/docker/nginx.conf");
  assert.match(nginx, /location \/agent\/ \{/);
  assert.match(nginx, /proxy_pass http:\/\/agent-gateway:8787\//);
  assert.match(nginx, /client_max_body_size 1100k/);
  assert.match(nginx, /proxy_set_header Origin \$http_origin/);
  assert.match(nginx, /Cache-Control "no-store"/);
});

test("operator lifecycle generates, bootstraps, backs up, and restores the signer", async () => {
  const script = await source("scripts/hestia");
  assert.match(script, /openssl genpkey -algorithm Ed25519/);
  assert.match(script, /bootstrap_agent_environment/);
  assert.match(script, /HESTIA_ADMIN_DATABASE_URL=/);
  assert.match(script, /install -m 600 "\$environment_key_file" "\$destination\/environment-signing\.pem"/);
  assert.match(script, /sha256sum hestia\.dump environment-signing\.pem/);
  assert.match(script, /client-env\)/);
  assert.match(script, /HESTIA_AGENT_API=/);
  assert.doesNotMatch(script, /printf 'HESTIA_(POSTGRES_PASSWORD|APP_PASSWORD|JWT_SECRET|TURN_SECRET)=/);
});

test("Make targets expose bootstrap and browser-safe client configuration", async () => {
  const makefile = await source("Makefile");
  assert.match(makefile, /^bootstrap-agent:/m);
  assert.match(makefile, /\$\(HESTIA\) bootstrap-agent/);
  assert.match(makefile, /^client-env:/m);
  assert.match(makefile, /\$\(HESTIA\) client-env/);
});
