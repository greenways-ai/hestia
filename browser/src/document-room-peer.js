import "./document-room-api.js";
import { CeremonyPeer } from "./peer.js";
import { createSerialQueue } from "./kernel-queue.js";
import {
  assertGenesisMemberBinding,
  verifyDocumentRoomMember
} from "./document-room-member.js";

export const DOCUMENT_ROOM_DATA_PROTOCOL = "hestia-document-room/1";
export const DOCUMENT_ROOM_AWARENESS_PROTOCOL = "hestia-document-awareness/1";

function publicMember(member) {
  return {
    memberId: member.memberId,
    label: member.label,
    role: member.role,
    publicKeyJwk: member.publicKeyJwk,
    profileRecord: member.profileRecord,
    delegationRecord: member.delegationRecord
  };
}

export class DocumentRoomPeer extends EventTarget {
  constructor({ invite, record, room, endpoint }) {
    super();
    if (!room?.kernel || !room?.localMember) {
      throw new Error("document room peer requires a DocumentRoom instance");
    }
    this.invite = invite;
    this.record = record;
    this.room = room;
    this.role = room.role;
    this.pendingGenesis = null;
    this.serialize = createSerialQueue();
    this.transport = new CeremonyPeer({
      invite,
      record,
      endpoint,
      dataProtocol: DOCUMENT_ROOM_DATA_PROTOCOL,
      channelLabel: "hestia-document-v1",
      awarenessProtocol: DOCUMENT_ROOM_AWARENESS_PROTOCOL,
      awarenessChannelLabel: "hestia-document-awareness-v1"
    });
    this.bindTransport();
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  bindTransport() {
    for (const type of ["peer", "connection-state", "error"]) {
      this.transport.addEventListener(type, ({ detail }) => this.emit(type, detail));
    }
    this.transport.addEventListener("disconnected", ({ detail }) => {
      this.serialize(async () => {
        this.emit("disconnected", detail);
        await this.execute(await this.room.kernel.dispatch("transport/disconnected", detail));
      }).catch((error) => this.fail(error));
    });
    this.transport.addEventListener("connected", ({ detail }) => {
      this.serialize(async () => {
        this.emit("connected", detail);
        await this.execute(await this.room.kernel.dispatch("transport/connected"));
      }).catch((error) => this.fail(error));
    });
    this.transport.addEventListener("message", ({ detail }) => {
      this.serialize(() => this.handleMessage(detail.type, detail.payload))
        .catch((error) => this.fail(error));
    });
    this.transport.addEventListener("awareness", ({ detail }) => {
      this.emit("awareness", detail);
    });
  }

  async start() {
    await verifyDocumentRoomMember(this.room.localMember(), {
      documentId: this.room.document.id
    });
    await this.execute(await this.room.kernel.dispatch("room/start"));
    return this;
  }

  async execute(outcome) {
    this.emit("view", { view: outcome.view });
    for (const command of outcome.commands || []) {
      const [value] = command.args || [];
      if (command.capability === "transport" && command.action === "connect") {
        await this.transport.connect();
      } else if (command.capability === "transport" && command.action === "send-join") {
        await this.sendJoin();
      } else if (command.capability === "room" && command.action === "issue-genesis") {
        await this.issueGenesis();
      } else if (command.capability === "document" && command.action === "sign-and-send-batch") {
        await this.sendLocalBatch(value);
      } else if (command.capability === "document" && command.action === "sequence-local-batch") {
        await this.sequenceLocalBatch(value);
      } else if (command.capability === "document" && command.action === "sequence-remote-batch") {
        await this.sequenceRemoteBatch(value);
      } else if (command.capability === "document" && command.action === "verify-commit") {
        await this.verifyCommit(value);
      } else {
        throw new Error(`unsupported document room command: ${command.capability}/${command.action}`);
      }
    }
    return outcome;
  }

  async sendJoin() {
    await this.transport.send("room/join", {
      roomId: this.room.roomId,
      documentId: this.room.document.id,
      member: publicMember(this.room.localMember())
    });
  }

  async issueGenesis() {
    if (this.room.genesis) return;
    const genesis = await this.room.issueGenesis();
    await this.transport.send("room/genesis", {
      genesis,
      snapshot: this.room.snapshot()
    });
    await this.execute(await this.room.kernel.dispatch("room/genesis-accepted", {
      epoch: genesis.record.body.epoch,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("ready", { role: this.role, genesis });
  }

  async acceptGenesisPayload(payload) {
    const projections = payload?.genesis?.record?.body?.members;
    if (!Array.isArray(projections) || !projections.length) {
      throw new Error("document room genesis has no signed membership");
    }
    for (const projection of projections) {
      const member = this.room.members.get(projection.member_id);
      if (!member?.profileRecord?.body || !member?.delegationRecord?.body) {
        this.pendingGenesis = payload;
        return false;
      }
      await verifyDocumentRoomMember(member, { documentId: this.room.document.id });
      assertGenesisMemberBinding(projection, member);
    }
    this.pendingGenesis = null;
    await this.room.acceptGenesis(payload.genesis);
    await this.execute(await this.room.kernel.dispatch("room/genesis-accepted", {
      epoch: payload.genesis.record.body.epoch,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("ready", { role: this.role, genesis: payload.genesis });
    await this.requestSync();
    return true;
  }

  async handleMessage(type, payload) {
    if (type === "room/join") {
      if (payload.roomId !== this.room.roomId || payload.documentId !== this.room.document.id) {
        throw new Error("document room join mismatch");
      }
      await verifyDocumentRoomMember(payload.member, {
        documentId: this.room.document.id
      });
      this.room.addMember(payload.member);
      await this.execute(await this.room.kernel.dispatch("peer/joined", {
        peer_id: payload.member.memberId
      }));
      if (this.pendingGenesis) await this.acceptGenesisPayload(this.pendingGenesis);
      return;
    }
    if (type === "room/genesis") {
      await this.acceptGenesisPayload(payload);
      return;
    }
    if (type === "document/batch") {
      await this.execute(await this.room.kernel.dispatch("batch/received", payload));
      return;
    }
    if (type === "document/commit") {
      await this.execute(await this.room.kernel.dispatch("commit/received", payload));
      return;
    }
    if (type === "document/sync-request") {
      if (this.role !== "sequencer") return;
      const after = Number(payload?.revision || 0);
      await this.transport.send("document/sync-response", {
        genesis: this.room.genesis,
        commits: this.room.history
          .filter((entry) => entry.sequence > Number(payload?.sequence || 0))
          .map((entry) => entry.commit)
          .filter(Boolean),
        snapshot: this.room.snapshot(),
        after
      });
      return;
    }
    if (type === "document/sync-response") {
      if (!this.room.genesis && payload.genesis) {
        const accepted = await this.acceptGenesisPayload({ genesis: payload.genesis });
        if (!accepted) return;
      }
      for (const commit of payload.commits || []) await this.verifyCommit(commit);
      this.emit("sync", { snapshot: payload.snapshot });
      return;
    }
    throw new Error(`unknown document room message: ${type}`);
  }

  async submit(operations, options = {}) {
    return this.serialize(async () => this.execute(await this.room.kernel.dispatch("edit/submit", {
      operations,
      options
    })));
  }

  async sendLocalBatch({ operations, options = {} }) {
    const batch = await this.room.createBatch(operations, options);
    await this.transport.send("document/batch", {
      batch,
      authorMemberId: this.room.localMemberId
    });
    this.emit("pending", { batch });
  }

  async sequenceLocalBatch({ operations, options = {} }) {
    const batch = await this.room.createBatch(operations, options);
    const commit = await this.room.sequenceBatch(batch, this.room.localMemberId);
    this.room.history.at(-1).commit = commit;
    await this.transport.send("document/commit", commit);
    await this.execute(await this.room.kernel.dispatch("revision/applied", {
      outcome: commit.outcome,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("commit", { commit, document: this.room.document });
  }

  async sequenceRemoteBatch({ batch, authorMemberId }) {
    const commit = await this.room.sequenceBatch(batch, authorMemberId);
    this.room.history.at(-1).commit = commit;
    await this.transport.send("document/commit", commit);
    await this.execute(await this.room.kernel.dispatch("revision/applied", {
      outcome: commit.outcome,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("commit", { commit, document: this.room.document });
  }

  async verifyCommit(commit) {
    await this.room.applyCommit(commit);
    this.room.history.at(-1).commit = commit;
    await this.execute(await this.room.kernel.dispatch("revision/applied", {
      outcome: commit.outcome,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("commit", { commit, document: this.room.document });
  }

  requestSync() {
    return this.transport.send("document/sync-request", {
      revision: this.room.revision,
      headRoot: this.room.headRoot,
      sequence: this.room.sequence
    });
  }

  awareness(type, payload) {
    return this.transport.sendAwareness(type, payload);
  }

  async fail(error) {
    this.emit("error", { error });
    try {
      await this.execute(await this.room.kernel.dispatch("error", {
        message: error?.message || String(error)
      }));
    } catch {
      // Preserve the original failure.
    }
  }

  close() {
    this.transport.close();
  }
}
