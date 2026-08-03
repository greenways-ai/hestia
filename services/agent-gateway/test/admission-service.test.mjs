import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createAgentAdmissionService } from "../src/admission-service.mjs";
import { createEnvironmentSigner } from "../src/environment-signer.mjs";
import { AGENT_HTTP_PROTOCOL } from "../src/protocol.mjs";

const ROOTS = Object.freeze({
  record: "a".repeat(64),
  body: "b".repeat(64),
  signer: "c".repeat(64),
  verificationReceipt: "d".repeat(64),
  verificationSigned: "e".repeat(64),
  admissionReceipt: "f".repeat(64),
  admissionSigned: "1".repeat(64),
  state: "2".repeat(64),
  environment: "3".repeat(64)
});

function signer() {
  const pair = generateKeyPairSync("ed25519");
  return createEnvironmentSigner(
    pair.privateKey.export({ format: "pem", type: "pkcs8" })
  );
}

function request(kind, capability) {
  const value = {
    protocol: AGENT_HTTP_PROTOCOL,
    request_id: `request:${kind.replaceAll("/", "-")}`,
    record: {
      root: `sha256:${ROOTS.record}`,
      kind,
      hcp1_pack: "HCP1:1:C:fixture"
    }
  };
  if (capability) value.capability = capability.toString("base64url");
  return value;
}

function database(environmentSigner) {
  const calls = [];
  const receipt = Buffer.from("receipt-signing-payload");
  const prepared = (extra = {}) => ({
    sequence: "7",
    receiptRootHex: ROOTS.admissionReceipt,
    receiptSigningPayload: receipt,
    result_state_root_hex: ROOTS.state,
    ...extra
  });
  const transaction = {
    async prepareVerification(input) {
      calls.push(["prepareVerification", input]);
      return {
        sequence: "3",
        body_root_hex: ROOTS.body,
        signer_key_root_hex: ROOTS.signer,
        receiptRootHex: ROOTS.verificationReceipt,
        receiptSigningPayload: Buffer.from("verification-signing-payload")
      };
    },
    async commitVerification(input) {
      calls.push(["commitVerification", input]);
      assert.equal(input.signature.length, 64);
      return ROOTS.verificationSigned;
    },
    async prepareProfile(input) {
      calls.push(["prepareProfile", input]);
      return prepared({ profile_id: "profile:test", profile_sequence: "1" });
    },
    async commitProfile(input) {
      calls.push(["commitProfile", input]);
      return ROOTS.admissionSigned;
    },
    async prepareRoomGenesis(input) {
      calls.push(["prepareRoomGenesis", input]);
      return prepared({ room_id: "room:test" });
    },
    async commitRoomGenesis(input) {
      calls.push(["commitRoomGenesis", input]);
      return ROOTS.admissionSigned;
    },
    async prepareInvitation(input) {
      calls.push(["prepareInvitation", input]);
      return prepared({ invite_id: "invite:test" });
    },
    async commitInvitation(input) {
      calls.push(["commitInvitation", input]);
      return ROOTS.admissionSigned;
    },
    async prepareMember(input) {
      calls.push(["prepareMember", input]);
      return prepared({
        room_id: "room:test",
        member_profile_id: "profile:guest",
        next_membership_epoch: "2"
      });
    },
    async commitMember(input) {
      calls.push(["commitMember", input]);
      return ROOTS.admissionSigned;
    }
  };
  return {
    calls,
    async transaction(operation) {
      calls.push(["begin"]);
      const result = await operation(transaction);
      calls.push(["commit"]);
      return result;
    },
    async environment() {
      return {
        key_root_hex: ROOTS.environment,
        public_key_hex: environmentSigner.publicKeyBytes.toString("hex"),
        status: "active"
      };
    },
    async close() {
      calls.push(["close"]);
    }
  };
}

for (const [kind, prepare, commit] of [
  ["profile/version", "prepareProfile", "commitProfile"],
  ["room/version", "prepareRoomGenesis", "commitRoomGenesis"],
  ["room/invitation", "prepareInvitation", "commitInvitation"],
  ["room/admission-proof", "prepareMember", "commitMember"]
]) {
  test(`verifies and admits ${kind} through the exact database capability`, async () => {
    const environmentSigner = signer();
    const db = database(environmentSigner);
    const service = createAgentAdmissionService({
      database: db,
      signer: environmentSigner,
      environmentId: "hestia-test"
    });
    const capability = kind === "room/admission-proof" ? Buffer.alloc(32, 9) : undefined;
    const result = await service.admit(request(kind, capability));

    assert.equal(result.ok, true);
    assert.equal(result.record_root, `sha256:${ROOTS.record}`);
    assert.equal(result.record_kind, kind);
    assert.equal(result.verification.body_root, `sha256:${ROOTS.body}`);
    assert.equal(result.verification.signed_receipt_root, `sha256:${ROOTS.verificationSigned}`);
    assert.equal(result.admission.receipt_root, `sha256:${ROOTS.admissionReceipt}`);
    assert.equal(result.admission.signed_receipt_root, `sha256:${ROOTS.admissionSigned}`);
    assert.equal(result.admission.result_state_root, `sha256:${ROOTS.state}`);
    assert.deepEqual(
      db.calls.map(([name]) => name),
      ["begin", "prepareVerification", "commitVerification", prepare, commit, "commit"]
    );
    if (capability) {
      const memberCall = db.calls.find(([name]) => name === "prepareMember")[1];
      assert.deepEqual(memberCall.capability, capability);
    }
  });
}

test("refuses to serve a database registered to another environment key", async () => {
  const environmentSigner = signer();
  const db = database(environmentSigner);
  db.environment = async () => ({
    key_root_hex: ROOTS.environment,
    public_key_hex: "00".repeat(32),
    status: "active"
  });
  const service = createAgentAdmissionService({
    database: db,
    signer: environmentSigner,
    environmentId: "hestia-test"
  });
  await assert.rejects(() => service.health(), /does not match the local key/);
});
