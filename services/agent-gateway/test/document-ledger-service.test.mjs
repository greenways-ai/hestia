import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { generateAgentKey } from "../../../browser/src/agent-protocol.js";
import {
  documentSigningBytes,
  documentValuePlan
} from "../../../browser/src/document-hcv1.js";
import {
  createDocumentBatchBundle,
  createDocumentOperationPlan
} from "../../../browser/src/document-records.js";
import { createEnvironmentSigner } from "../src/environment-signer.mjs";
import { createDocumentLedgerService } from "../src/document-ledger-service.mjs";

const root = (character) => character.repeat(64);

function fixture(text = "Hello world", revision = 0) {
  return {
    profile: "greenways.rich-text/0-alpha",
    id: "document:service",
    revision,
    children: [{
      id: "paragraph:one",
      type: "paragraph",
      attrs: {},
      children: [{ id: "text:one", type: "text", text, marks: [] }]
    }]
  };
}

async function batchFixture({ expectedText = "Hello Hara" } = {}) {
  const key = await generateAgentKey();
  const [profile, delegation] = await Promise.all([
    documentValuePlan({ profile_id: "profile:writer", sequence: 1 }),
    documentValuePlan({ purpose: "document.edit", document_id: "document:service" })
  ]);
  const baseAst = fixture();
  const expectedResultAst = fixture(expectedText, 1);
  const bundle = await createDocumentBatchBundle({
    documentId: baseAst.id,
    batchId: "batch:service",
    baseRevision: 0,
    baseAst,
    operations: [{
      id: "operation:replace",
      type: "text.splice",
      targetId: "text:one",
      offset: 6,
      deleteCount: 5,
      insert: "Hara"
    }],
    expectedResultAst,
    authorProfileRecord: profile,
    delegationRecord: delegation,
    signingKey: key
  });
  return { bundle, baseAst, expectedResultAst };
}

function environmentSigner() {
  const pair = generateKeyPairSync("ed25519");
  return createEnvironmentSigner(pair.privateKey.export({ type: "pkcs8", format: "pem" }));
}

function fakeDatabase({ head = null, acceptedOperations = [] } = {}) {
  const calls = [];
  let verification = 0;
  let preparedRevision = null;
  const database = {
    calls,
    get preparedRevision() { return preparedRevision; },
    async documentTransaction(operation) {
      return operation({
        async prepareDocumentRecordVerification(input) {
          calls.push(["verify.prepare", input.recordKind]);
          verification += 1;
          const receiptRootHex = verification === 1 ? root("a") : root("b");
          return {
            sequence: String(verification),
            bodyRootHex: root(verification === 1 ? "c" : "d"),
            signerKeyRootHex: root(verification === 1 ? "e" : "f"),
            receiptRootHex,
            receiptSigningPayload: Buffer.from(
              documentSigningBytes("document/verification-receipt", receiptRootHex)
            )
          };
        },
        async commitDocumentRecordVerification(input) {
          calls.push(["verify.commit", input.recordRootHex]);
          assert.equal(input.signature.length, 64);
          return verification === 1 ? root("1") : root("2");
        },
        async documentHead(documentId) {
          calls.push(["head", documentId]);
          return head;
        },
        async documentOperationsAfter(input) {
          calls.push(["operations", input.revision]);
          return acceptedOperations;
        },
        async prepareDocumentRevision(input) {
          calls.push(["revision.prepare", input.outcome]);
          preparedRevision = input;
          return {
            documentId: input.documentId,
            outcome: input.outcome,
            sequence: "7",
            revision: input.outcome === "accepted" ? "1" : null,
            revisionRootHex: input.outcome === "accepted" ? root("3") : null,
            resultAstRootHex: root("4"),
            receiptRootHex: root("5"),
            receiptSigningPayload: Buffer.from(
              documentSigningBytes("document/import-receipt", root("5"))
            ),
            conflict: input.conflict
          };
        },
        async commitDocumentRevision(input) {
          calls.push(["revision.commit", input.batchRecordRootHex]);
          assert.equal(input.signature.length, 64);
          return root("6");
        }
      });
    }
  };
  return database;
}

test("verifies batch and transformation, then signs only ledger-prepared receipt bytes", async () => {
  const { bundle } = await batchFixture();
  const database = fakeDatabase();
  const result = await createDocumentLedgerService({
    database,
    signer: environmentSigner(),
    environmentId: "hestia-test"
  }).admit({ batch: bundle });

  assert.equal(result.outcome, "accepted");
  assert.equal(result.document_id, "document:service");
  assert.match(result.transformation_root, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(database.calls.map(([name]) => name), [
    "verify.prepare",
    "verify.commit",
    "head",
    "operations",
    "verify.prepare",
    "verify.commit",
    "revision.prepare",
    "revision.commit"
  ]);
  assert.equal(database.preparedRevision.resultAst.children[0].children[0].text, "Hello Hara");
  assert.equal(database.preparedRevision.resultAst.revision, 1);
});

test("rejects a signed expected result that is not produced by operation replay", async () => {
  const { bundle } = await batchFixture({ expectedText: "Forged result" });
  await assert.rejects(
    () => createDocumentLedgerService({
      database: fakeDatabase(),
      signer: environmentSigner(),
      environmentId: "hestia-test"
    }).admit({ batch: bundle }),
    /expected result does not match replay/
  );
});

test("rejects an expected-result projection altered after the batch was signed", async () => {
  const { bundle } = await batchFixture();
  bundle.expectedResultAst.children[0].children[0].text = "Altered after signing";
  await assert.rejects(
    () => createDocumentLedgerService({
      database: fakeDatabase(),
      signer: environmentSigner(),
      environmentId: "hestia-test"
    }).admit({ batch: bundle }),
    /signed HCV0 record/
  );
});

test("rebases a stale signed batch through root-verified operations already accepted by the Hara ledger", async () => {
  const { bundle } = await batchFixture();
  const accepted = {
    id: "operation:accepted",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "Bright ",
    baseRevision: 0,
    environmentSequence: 1
  };
  const acceptedPlan = await createDocumentOperationPlan(
    bundle.documentId,
    accepted,
    accepted.baseRevision
  );
  const database = fakeDatabase({
    head: {
      revision: "1",
      revisionRoot: `sha256:${root("7")}`,
      astRoot: `sha256:${root("8")}`,
      ast: fixture("Bright Hello world", 1)
    },
    acceptedOperations: [{ root: acceptedPlan.root, operation: accepted }]
  });
  const result = await createDocumentLedgerService({
    database,
    signer: environmentSigner(),
    environmentId: "hestia-test"
  }).admit({ batch: bundle });

  assert.equal(result.outcome, "accepted");
  assert.equal(
    database.preparedRevision.resultAst.children[0].children[0].text,
    "Bright Hello Hara"
  );
  assert.equal(database.preparedRevision.resultAst.revision, 2);
  assert.equal(database.preparedRevision.transformedOperations[0].offset, 13);
});

test("rejects a corrupted accepted-operation projection before using it for OT", async () => {
  const { bundle } = await batchFixture();
  const accepted = {
    id: "operation:accepted",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "Bright ",
    baseRevision: 0,
    environmentSequence: 1
  };
  const database = fakeDatabase({
    head: {
      revision: "1",
      revisionRoot: `sha256:${root("7")}`,
      astRoot: `sha256:${root("8")}`,
      ast: fixture("Bright Hello world", 1)
    },
    acceptedOperations: [{ root: `sha256:${root("9")}`, operation: accepted }]
  });
  await assert.rejects(
    () => createDocumentLedgerService({
      database,
      signer: environmentSigner(),
      environmentId: "hestia-test"
    }).admit({ batch: bundle }),
    /does not match its Hara ledger root/
  );
});

test("rejects a batch projection changed after its operation vector was signed", async () => {
  const { bundle } = await batchFixture();
  bundle.operations.push({
    id: "operation:missing",
    type: "node.delete",
    targetId: "missing-node"
  });
  const database = fakeDatabase();
  await assert.rejects(
    () => createDocumentLedgerService({
      database,
      signer: environmentSigner(),
      environmentId: "hestia-test"
    }).admit({ batch: bundle }),
    /operation vector root does not match/
  );
  assert.equal(database.calls.length, 0);
});
