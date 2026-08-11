import assert from "node:assert/strict";
import test from "node:test";
import { documentSigningBytes } from "../src/document-hcv1.js";

test("GWDP0 signing bytes contain NUL separators and raw root bytes", () => {
  const bytes = documentSigningBytes("document/batch", `sha256:${"01".repeat(32)}`);
  const prefix = new TextEncoder().encode("GWDP0\0document/batch\0");
  assert.deepEqual([...bytes.slice(0, prefix.length)], [...prefix]);
  assert.equal(bytes.length, prefix.length + 32);
  assert.deepEqual([...bytes.slice(-32)], Array.from({ length: 32 }, () => 1));
  assert.notEqual(new TextDecoder().decode(bytes.slice(-32)), "01".repeat(32));
});
