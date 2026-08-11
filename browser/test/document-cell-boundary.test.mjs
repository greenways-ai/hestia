import assert from "node:assert/strict";
import test from "node:test";
import { documentValuePlan } from "../src/document-hcv1.js";

function count(pack) {
  return Number(/^HCP0:([0-9]+):/.exec(pack)?.[1]);
}

test("document values expose canonical roots and bounded HCP0 cells", async () => {
  const plan = await documentValuePlan({
    profile: "greenways.rich-text/0-alpha",
    children: [{ id: "text:one", type: "text", text: "Hara", marks: [] }]
  });
  assert.match(plan.root, /^sha256:[0-9a-f]{64}$/);
  assert.ok(count(plan.hcp1_pack) >= 1);
  assert.equal(count(plan.hcp1_pack), plan.hcv1_cells.length);
});
