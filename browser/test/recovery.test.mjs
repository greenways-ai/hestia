import assert from "node:assert/strict";
import test from "node:test";
import { generateSigningKey } from "../src/keystore.js";
import {
  generateCeremonyKey,
  openCeremonyShare,
  sealShareForCeremony
} from "../src/recovery.js";

test("keeper shares are signed and sealed to one browser ceremony key", async () => {
  const browser = await generateCeremonyKey();
  const keeper = await generateSigningKey();
  const share = new Uint8Array([2, 10, 20, 30, 40]);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const envelope = await sealShareForCeremony({
    share,
    ceremonyId: "ceremony-812",
    browserPublicKey: browser.publicKey,
    keeperSigningKey: keeper.privateKey,
    keeperId: "institution:a/node-7",
    policyHash: "sha256:policy",
    expiresAt
  });
  assert.deepEqual(await openCeremonyShare({
    envelope,
    browserPrivateKey: browser.privateKey,
    keeperSigningPublicKey: keeper.publicKey
  }), share);

  const tampered = { ...envelope, keeper: "institution:attacker" };
  await assert.rejects(openCeremonyShare({
    envelope: tampered,
    browserPrivateKey: browser.privateKey,
    keeperSigningPublicKey: keeper.publicKey
  }), /invalid keeper signature/);
});

test("expired share envelopes are rejected before decryption", async () => {
  const browser = await generateCeremonyKey();
  const keeper = await generateSigningKey();
  const envelope = await sealShareForCeremony({
    share: new Uint8Array([1, 2, 3]),
    ceremonyId: "ceremony-813",
    browserPublicKey: browser.publicKey,
    keeperSigningKey: keeper.privateKey,
    keeperId: "institution:b/node-2",
    policyHash: "sha256:policy",
    expiresAt: new Date(Date.now() - 1_000).toISOString()
  });
  await assert.rejects(openCeremonyShare({
    envelope,
    browserPrivateKey: browser.privateKey,
    keeperSigningPublicKey: keeper.publicKey
  }), /expired/);
});
