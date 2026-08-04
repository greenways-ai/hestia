import { DocumentRoom as DocumentRoomCore } from "./document-room.js";

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

export const DocumentRoom = DocumentRoomCore;
