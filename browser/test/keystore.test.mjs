import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecoveryPackage,
  generateSigningKey,
  restoreRecoveryPackage
} from "../src/keystore.js";
import { combineShares, splitSecret } from "../src/shamir.js";

test("encrypts a private key behind a threshold recovery secret", async () => {
  const original = await generateSigningKey();
  const { recoverySecret, encryptedPackage } = await createRecoveryPackage({
    identity: "person:chris",
    keyVersion: 4,
    signingKeyPair: original,
    policyHash: "sha256:policy"
  });
  const shares = splitSecret(recoverySecret, { shares: 3, threshold: 2 });
  const reconstructed = combineShares([shares[0], shares[2]]);
  const restored = await restoreRecoveryPackage(encryptedPackage, reconstructed);
  const message = new TextEncoder().encode("hestia recovery");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, restored.signingKeyPair.privateKey, message
  );
  assert.equal(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, original.publicKey, signature, message
  ), true);
  reconstructed.fill(0);
  recoverySecret.fill(0);
});
