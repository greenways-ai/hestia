import {
  haraSession,
  registerHaraResources,
  toHta,
  toPlain
} from "./hara.js";
import { createSerialQueue } from "./kernel-queue.js";

const ledgerResources = Object.freeze([
  [
    "gw.ledger.document-protocol",
    new URL("../hara-ledger/document_protocol.hal", import.meta.url)
  ],
  [
    "gw.ledger.document-ot",
    new URL("../hara-ledger/document_ot.hal", import.meta.url)
  ]
]);

let nextKernel = 0;

export async function createDocumentRoomKernel({ role, roomId, documentId }) {
  if (role !== "sequencer" && role !== "participant") {
    throw new Error("document room kernel role must be sequencer or participant");
  }
  if (!roomId || !documentId) throw new Error("document room kernel requires roomId and documentId");
  await registerHaraResources(ledgerResources);
  const session = await haraSession(
    `HESTIA-DOCUMENT-ROOM-${++nextKernel}`,
    "[hestia.document-room :as room]"
  );
  let state = await session.evalBound(
    "(room/initial-state __hta_arg_0 __hta_arg_1 __hta_arg_2)",
    [role, roomId, documentId]
  );
  const serialize = createSerialQueue();

  return Object.freeze({
    role,
    roomId,
    documentId,

    dispatch(type, data = {}) {
      return serialize(async () => {
        const result = await session.evalBound(
          "(room/advance __hta_arg_0 __hta_arg_1)",
          [state, toHta({ type, data })]
        );
        state = result.get("state");
        return toPlain(result);
      });
    },

    transform(batch, acceptedOperations = []) {
      return serialize(async () => toPlain(await session.evalBound(
        "(room/transform-batch __hta_arg_0 __hta_arg_1)",
        [toHta(batch), toHta(acceptedOperations)]
      )));
    },

    evaluate(source) {
      return serialize(async () => toPlain(await session.eval(String(source))));
    },

    view() {
      return serialize(async () => toPlain(
        await session.evalBound("(room/view __hta_arg_0)", [state])
      ));
    }
  });
}
