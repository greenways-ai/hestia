import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  verify as verifyDetached
} from "node:crypto";
import test from "node:test";
import { createEnvironmentSigner } from "../src/environment-signer.mjs";

function ed25519Pem() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKey: pair.publicKey
  };
}

test("loads an Ed25519 PEM and signs exact receipt bytes", () => {
  const generated = ed25519Pem();
  const signer = createEnvironmentSigner(generated.privateKey);
  const payload = Buffer.from("GWAR1:ledger/admission-receipt:" + "a".repeat(64));
  const signature = signer.sign(payload);

  assert.equal(signer.publicKeyBytes.length, 32);
  assert.equal(signature.length, 64);
  assert.equal(signer.verify(payload, signature), true);
  assert.equal(verifyDetached(null, payload, generated.publicKey, signature), true);
  assert.equal(signer.verify(Buffer.from("different"), signature), false);
});

test("rejects a non-Ed25519 environment key", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" });
  assert.throws(() => createEnvironmentSigner(pem), /must be Ed25519/);
});
