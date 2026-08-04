import { haraSession, toHta, toPlain } from "./hara.js";
import { createSerialQueue } from "./kernel-queue.js";

let nextKernel = 0;
const programUrl = new URL("../hara/workflow_v3.hal", import.meta.url);
let programSourcePromise;

async function programSource() {
  programSourcePromise ??= fetch(programUrl, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`Unable to inspect the Recovery HAL program (${response.status})`);
    return response.text();
  }).catch((error) => {
    programSourcePromise = undefined;
    throw error;
  });
  return programSourcePromise;
}

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
    },
    snapshot() {
      return serialize(async () => toPlain(state));
    },
    program() {
      return serialize(async () => ({
        ...toPlain(await session.eval("(workflow/program-info)")),
        source: await programSource(),
        source_url: programUrl.href
      }));
    }
  });
}
