import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const repository = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("the microsite has the canonical Hestia identity and primary journeys", async () => {
  const [config, layout, home] = await Promise.all([
    source("astro.config.mjs"),
    source("src/layouts/BaseLayout.astro"),
    source("src/pages/index.astro")
  ]);
  assert.match(config, /site: "https:\/\/oss\.greenways\.ai"/);
  assert.match(config, /base: "\/hestia"/);
  assert.match(layout, /GREENWAYS/);
  assert.match(layout, /SoftwareApplication/);
  assert.match(home, /A private office/);
  assert.match(home, /Named agents/);
  assert.match(home, /Human approvals/);
  assert.match(home, /scripts\/hestia init/);
  assert.match(home, /recovery-demo/);
  assert.match(home, /https:\/\/github\.com\/greenways-ai\/hestia/);
});

test("the new Netlify site remains separate from the recovery Pages artifact", async () => {
  const [netlify, pagesBuild, demoRoot] = await Promise.all([
    readFile(new URL("netlify.toml", repository), "utf8"),
    readFile(new URL("browser/scripts/build-pages.mjs", repository), "utf8"),
    readFile(new URL("browser/site/index.html", repository), "utf8")
  ]);
  assert.match(netlify, /base = "site"/);
  assert.match(netlify, /publish = "dist"/);
  assert.match(pagesBuild, /browser\/site/);
  assert.match(demoRoot, /url=\/recovery\//);
  assert.doesNotMatch(netlify, /hestia-demo/);
});

test("generated editorial artwork and the deployment-owned social card are optimized and present", async () => {
  for (const name of [
    "hestia-sanctuary.webp",
    "hestia-sanctuary-mobile.webp",
    "hestia-sanctuary.jpg",
    "hestia-recovery-keepers.webp",
    "hestia-recovery-keepers.jpg",
    "hestia-local-ledger.webp",
    "hestia-local-ledger.jpg",
    "og-hestia.jpg"
  ]) {
    const image = await stat(new URL("public/assets/" + name, root));
    assert.ok(image.size > 30_000, name + " should contain rendered artwork");
    assert.ok(image.size < 900_000, name + " should be web-optimized");
  }
});

test("metadata declares the same-origin 1200 by 630 Hestia social image", async () => {
  const layout = await source("src/layouts/BaseLayout.astro");
  assert.match(layout, /\$\{base\}assets\/og-hestia\.jpg/);
  assert.match(layout, /og:image:secure_url/);
  assert.match(layout, /og:image:type" content="image\/jpeg"/);
  assert.match(layout, /og:image:width" content="1200"/);
  assert.match(layout, /og:image:height" content="630"/);
  assert.match(layout, /twitter:image:alt/);
  assert.doesNotMatch(layout, /visual-language\/assets\/og-hestia/);
});
