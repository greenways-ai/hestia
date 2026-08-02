import { haraSession, toHta, toPlain } from "/hestia-browser/hara.js";

export async function createCeremonyKernel() {
  const session = await haraSession("HESTIA-CEREMONY", "[hestia.ceremony :as ceremony]");
  let state = await session.eval("(ceremony/initial-state)");
  return Object.freeze({
    async dispatch(type, data = {}) {
      const result = await session.evalBound(
        "(ceremony/advance __hta_arg_0 __hta_arg_1)",
        [state, toHta({ type, data })]
      );
      state = result.get("state");
      return toPlain(result);
    },
    async view() {
      return toPlain(await session.evalBound("(ceremony/view __hta_arg_0)", [state]));
    }
  });
}
