import test from "node:test";
import assert from "node:assert/strict";
globalThis.btoa ??= (value) => Buffer.from(value, "binary").toString("base64");
globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("binary");

const { createIdentityPackage, restoreIdentityPackage } = await import("../src/recovery-v3.js");

test("v3 identity needs both the authority secret and managed user factor", async () => {
  const created = await createIdentityPackage({ name: "Aurelia", scenario: "personal" });
  assert.equal(created.userFactor.length, 32);
  const restored = await restoreIdentityPackage(created);
  assert.equal(restored.data.name, "Aurelia");
  assert.deepEqual(restored.packageKeyBytes, created.packageKeyBytes);

  const wrongFactor = created.userFactor.slice();
  wrongFactor[0] ^= 1;
  await assert.rejects(
    restoreIdentityPackage({ ...created, userFactor: wrongFactor }),
    /credential vault factor or authority shares are incorrect/
  );
});
