import assert from "node:assert/strict";
import test from "node:test";
import { generateAgentKey } from "../src/agent-protocol.js";
import { documentValuePlan } from "../src/document-hcv1.js";
import { createDocumentBatchBundle } from "../src/document-records.js";

const operation = (index) => ({
  id: `operation:${index}`,
  type: "text.splice",
  targetId: "text:one",
  offset: 0,
  deleteCount: 0,
  insert: "x"
});

async function argumentsFor(operations) {
  const key = await generateAgentKey();
  const [profile, delegation] = await Promise.all([
    documentValuePlan({ profile: "writer" }),
    documentValuePlan({ purpose: "document.edit" })
  ]);
  const ast = { id: "document:bound", children: [{ id: "text:one", type: "text", text: "", marks: [] }] };
  return {
    documentId: ast.id,
    baseAst: ast,
    expectedResultAst: ast,
    operations,
    authorProfileRecord: profile,
    delegationRecord: delegation,
    signingKey: key
  };
}

test("requires one to 64 independently rooted operations", async () => {
  await assert.rejects(
    () => createDocumentBatchBundle(await argumentsFor([])),
    /one to 64 operations/
  );
  await assert.rejects(
    () => createDocumentBatchBundle(await argumentsFor(
      Array.from({ length: 65 }, (_, index) => operation(index))
    )),
    /one to 64 operations/
  );
});
