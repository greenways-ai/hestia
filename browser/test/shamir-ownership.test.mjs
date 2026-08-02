import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shamir arithmetic is owned by Hara and JS is only its HTA adapter", async () => {
  const adapter = await readFile(new URL("../src/shamir.js", import.meta.url), "utf8");
  const hara = await readFile(new URL("../hara/shamir.hal", import.meta.url), "utf8");
  assert.match(adapter, /HtaContext/);
  assert.match(adapter, /crypto\.random\/fill/);
  assert.doesNotMatch(adapter, /function multiply|function inverse|GF\(256\)/);
  assert.match(hara, /defn gf-multiply/);
  assert.match(hara, /defn split/);
  assert.match(hara, /defn combine/);
});
