import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(new URL("../src/http-server.mjs", import.meta.url), "utf8");

test("document admissions inherit no-store and origin checks from the gateway", async () => {
  const value = await source();
  assert.match(value, /"cache-control": "no-store"/);
  assert.match(value, /originAllowed\(request, allowedOrigins\)/);
  assert.match(value, /\/v1\/documents\/imports/);
  assert.match(value, /readJson\(request, maxBodyBytes\)/);
});
