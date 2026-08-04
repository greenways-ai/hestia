import assert from "node:assert/strict";
import test from "node:test";
import { generateAgentKey } from "../src/agent-protocol.js";
import { documentValuePlan } from "../src/document-hcv1.js";
import { DocumentRoom } from "../src/document-room-api.js";
import { transformBatch } from "../../protocol/document-ot.js";

function documentAst(text = "Hello world") {
  return {
    profile: "greenways.rich-text/2",
    id: "document:webrtc-test",
    revision: 0,
    children: [{
      id: "paragraph:one",
      type: "paragraph",
      attrs: {},
      children: [{ id: "text:one", type: "text", text, marks: [] }]
    }]
  };
}

function text(document) {
  return document.children[0].children[0].text;
}

function testKernel() {
  return {
    async transform(batch, accepted) {
      return transformBatch(batch, accepted);
    },
    async evaluate(source) {
      return source;
    }
  };
}

async function member(label, role) {
  const key = await generateAgentKey();
  const [profileRecord, delegationRecord] = await Promise.all([
    documentValuePlan({ profile: label, status: "active" }),
    documentValuePlan({ purpose: "document.edit", document: "document:webrtc-test" })
  ]);
  return {
    key,
    descriptor: {
      memberId: `member:${label}`,
      label,
      role,
      publicKeyJwk: key.publicJwk,
      profileRecord,
      delegationRecord
    }
  };
}

async function rooms() {
  const [hostMember, guestMember] = await Promise.all([
    member("host", "sequencer"),
    member("guest", "editor")
  ]);
  const initial = documentAst();
  const host = new DocumentRoom({
    role: "sequencer",
    roomId: "room:test",
    document: initial,
    kernel: testKernel(),
    documentKey: hostMember.key,
    localMember: hostMember.descriptor
  });
  const guest = new DocumentRoom({
    role: "participant",
    roomId: "room:test",
    document: initial,
    kernel: testKernel(),
    documentKey: guestMember.key,
    localMember: guestMember.descriptor
  });
  host.addMember(guestMember.descriptor);
  guest.addMember(hostMember.descriptor);
  const genesis = await host.issueGenesis();
  await guest.acceptGenesis(genesis);
  return { host, guest, hostMember, guestMember };
}

test("public room API keeps the environment sequence separate from batch sequencing", async () => {
  const { host } = await rooms();
  assert.equal(host.sequence, 0);
  assert.equal(typeof host.sequenceBatch, "function");
});

test("two kernels converge after a stale signed batch is transformed over the room history", async () => {
  const { host, guest, hostMember, guestMember } = await rooms();

  const firstBatch = await host.createBatch([{
    id: "operation:bright",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "Bright "
  }]);
  const firstCommit = await host.sequenceBatch(firstBatch, hostMember.descriptor.memberId);
  await guest.applyCommit(firstCommit);
  assert.equal(text(host.document), "Bright Hello world");
  assert.equal(text(guest.document), "Bright Hello world");
  assert.equal(host.revision, 1);
  assert.equal(guest.revision, 1);

  const secondBatch = await guest.createBatch([{
    id: "operation:hara",
    type: "text.splice",
    targetId: "text:one",
    offset: 6,
    deleteCount: 5,
    insert: "Hara"
  }], {
    baseRevision: 0,
    baseDocument: guest.snapshots.get(0)
  });
  const secondCommit = await host.sequenceBatch(secondBatch, guestMember.descriptor.memberId);
  await guest.applyCommit(secondCommit);

  assert.equal(text(host.document), "Bright Hello Hara");
  assert.equal(text(guest.document), "Bright Hello Hara");
  assert.equal(secondCommit.transformedOperations[0].offset, 13);
  assert.equal(host.revision, 2);
  assert.equal(guest.revision, 2);
  assert.equal(host.headRoot, guest.headRoot);
  assert.equal(host.history.length, 2);
  assert.equal(guest.history.length, 2);
  assert.match(secondCommit.receipt.record.root, /^sha256:[0-9a-f]{64}$/);
});

test("tampering with a transformed result is rejected by the receiving kernel", async () => {
  const { host, guest, hostMember } = await rooms();
  const batch = await host.createBatch([{
    id: "operation:tamper",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "Safe "
  }]);
  const commit = await host.sequenceBatch(batch, hostMember.descriptor.memberId);
  const tampered = structuredClone(commit);
  tampered.resultAst.children[0].children[0].text = "Unsafe";
  await assert.rejects(() => guest.applyCommit(tampered), /transformation root binding mismatch/);
  assert.equal(text(guest.document), "Hello world");
});

test("tampering with only the advertised revision root is rejected", async () => {
  const { host, guest, hostMember } = await rooms();
  const batch = await host.createBatch([{
    id: "operation:revision-tamper",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "Signed "
  }]);
  const commit = await host.sequenceBatch(batch, hostMember.descriptor.memberId);
  const tampered = structuredClone(commit);
  tampered.revision.root = `sha256:${"0".repeat(64)}`;
  await assert.rejects(
    () => guest.applyCommit(tampered),
    /revision root binding mismatch/
  );
  assert.equal(guest.revision, 0);
  assert.equal(text(guest.document), "Hello world");
});
