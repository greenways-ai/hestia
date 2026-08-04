import { DocumentRoomPeer as DocumentRoomPeerCore } from "./document-room-peer.js";
import { sequenceDocumentRoomBatch } from "./document-room-api.js";

export class DocumentRoomPeer extends DocumentRoomPeerCore {
  async sequenceLocalBatch({ operations, options = {} }) {
    const batch = await this.room.createBatch(operations, options);
    const commit = await sequenceDocumentRoomBatch(
      this.room,
      batch,
      this.room.localMemberId
    );
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
    const commit = await sequenceDocumentRoomBatch(
      this.room,
      batch,
      authorMemberId
    );
    this.room.history.at(-1).commit = commit;
    await this.transport.send("document/commit", commit);
    await this.execute(await this.room.kernel.dispatch("revision/applied", {
      outcome: commit.outcome,
      revision: this.room.revision,
      head_root: this.room.headRoot
    }));
    this.emit("commit", { commit, document: this.room.document });
  }
}
