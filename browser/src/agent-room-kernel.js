import { haraSession, toHta, toPlain } from "/hestia-browser/hara.js";

let nextKernel = 0;

export async function createAgentRoomKernel() {
  const session = await haraSession(
    `HESTIA-AGENT-ROOM-${++nextKernel}`,
    "[hestia.agent-room :as room]"
  );
  let state = await session.eval("(room/initial-state)");

  return Object.freeze({
    async dispatch(type, data = {}) {
      const result = await session.evalBound(
        "(room/advance __hta_arg_0 __hta_arg_1)",
        [state, toHta({ type, data })]
      );
      state = result.get("state");
      return toPlain(result);
    },

    async view() {
      return toPlain(await session.evalBound("(room/view __hta_arg_0)", [state]));
    }
  });
}
