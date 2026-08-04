import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live artefact output remains noncanonical until artefact.commit", async () => {
  const protocol = await readFile(
    new URL("../../docs/document-protocol-v1.md", import.meta.url),
    "utf8"
  );
  assert.match(protocol, /live result is a kernel projection/);
  assert.match(protocol, /MUST NOT become canonical merely because a client rendered/);
  assert.match(protocol, /`artefact\.commit` binds a reviewed source root to a result root/);
});
