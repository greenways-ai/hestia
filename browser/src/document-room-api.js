import { DocumentRoom as DocumentRoomCore } from "./document-room.js";

const acceptGenesisRecord = DocumentRoomCore.prototype.acceptGenesis;

function sameJwk(left, right) {
  const entries = (value) => Object.entries(value || {})
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

function bindSequencerMember(record) {
  const members = record?.body?.members;
  const sequencers = Array.isArray(members)
    ? members.filter((member) => member.role === "sequencer")
    : [];
  if (sequencers.length !== 1) {
    throw new Error("document room genesis must contain exactly one sequencer member");
  }
  const sequencer = sequencers[0];
  if (!sameJwk(sequencer.public_key_jwk, record.body.sequencer_key)) {
    throw new Error("document room sequencer member key does not match the signed sequencer key");
  }
  Object.defineProperty(record.body, "sequencer_member_id", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: sequencer.member_id
  });
  return sequencer.member_id;
}

export function sequenceDocumentRoomBatch(room, batch, authorMemberId) {
  if (!(room instanceof DocumentRoomCore)) {
    throw new Error("sequenceDocumentRoomBatch requires a DocumentRoom");
  }
  const sequenceMethod = DocumentRoomCore.prototype.sequence;
  if (typeof sequenceMethod !== "function") {
    throw new Error("DocumentRoom sequencing implementation is unavailable");
  }
  return sequenceMethod.call(room, batch, authorMemberId);
}

if (!Object.hasOwn(DocumentRoomCore.prototype, "sequenceBatch")) {
  Object.defineProperty(DocumentRoomCore.prototype, "sequenceBatch", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(batch, authorMemberId) {
      return sequenceDocumentRoomBatch(this, batch, authorMemberId);
    }
  });
}

Object.defineProperty(DocumentRoomCore.prototype, "acceptGenesis", {
  configurable: false,
  enumerable: false,
  writable: false,
  value(genesis) {
    const record = genesis?.record ?? genesis;
    const compatible = Object.assign({}, record, { record });
    return acceptGenesisRecord.call(this, compatible).then(() => {
      bindSequencerMember(record);
      this.genesis = genesis?.record ? genesis : { record };
      this.headRoot = record.root;
      return this.genesis;
    });
  }
});

const issueGenesisRecord = DocumentRoomCore.prototype.issueGenesis;
Object.defineProperty(DocumentRoomCore.prototype, "issueGenesis", {
  configurable: false,
  enumerable: false,
  writable: false,
  async value() {
    const genesis = await issueGenesisRecord.call(this);
    bindSequencerMember(genesis.record);
    return genesis;
  }
});

export const DocumentRoom = DocumentRoomCore;
