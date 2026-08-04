import { haraSession, toHta, toPlain } from "./hara.js";
import { createSerialQueue } from "./kernel-queue.js";

let nextKernel = 0;

export async function createCeremonyKernel() {
  const session = await haraSession(
    `HESTIA-CEREMONY-${++nextKernel}`,
    "[hestia.ceremony :as ceremony]"
  );
  let state = await session.eval("(ceremony/initial-state)");
  const serialize = createSerialQueue();
  return Object.freeze({
    dispatch(type, data = {}) {
      return serialize(async () => {
        const result = await session.evalBound(
          "(ceremony/advance __hta_arg_0 __hta_arg_1)",
          [state, toHta({ type, data })]
        );
        state = result.get("state");
        return toPlain(result);
      });
    },
    view() {
      return serialize(async () => toPlain(
        await session.evalBound("(ceremony/view __hta_arg_0)", [state])
      ));
    }
  });
}
