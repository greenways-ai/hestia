import { haraSession, toHta, toPlain } from "/hestia-browser/hara.js";
import { createSerialQueue } from "/hestia-browser/kernel-queue.js";

let nextKernel = 0;

export async function createWorkflowV3Kernel() {
  const session = await haraSession(
    `HESTIA-WORKFLOW-V3-${++nextKernel}`,
    "[hestia.workflow-v3 :as workflow]"
  );
  let state = await session.eval("(workflow/initial-state)");
  const serialize = createSerialQueue();
  return Object.freeze({
    dispatch(type, data = {}) {
      return serialize(async () => {
        const result = await session.evalBound(
          "(workflow/advance __hta_arg_0 __hta_arg_1)",
          [state, toHta({ type, data })]
        );
        state = result.get("state");
        return toPlain(result);
      });
    },
    view() {
      return serialize(async () => toPlain(
        await session.evalBound("(workflow/view __hta_arg_0)", [state])
      ));
    }
  });
}
