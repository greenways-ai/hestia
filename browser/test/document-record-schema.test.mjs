import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOCUMENT_RECORD_SCHEMAS } from "../src/document-hcv1.js";

const sql = () => readFile(
  new URL("../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("browser and PostgreSQL expose the same document record kinds", async () => {
  const migration = await sql();
  for (const kind of Object.keys(DOCUMENT_RECORD_SCHEMAS)) {
    assert.ok(migration.includes(`WHEN '${kind}'`) || migration.includes(`'${kind}'`), `SQL missing ${kind}`);
  }
});

test("operation and batch schemas preserve the normative role order", () => {
  assert.deepEqual(
    DOCUMENT_RECORD_SCHEMAS["document/batch"].map(([role]) => role),
    [
      "batch-id",
      "document-id",
      "base-revision",
      "base-ast",
      "operations",
      "expected-result",
      "author-profile",
      "delegation"
    ]
  );
  assert.deepEqual(
    DOCUMENT_RECORD_SCHEMAS["document/artefact-commit"].map(([role]) => role),
    [
      "operation-id",
      "document-id",
      "artefact-id",
      "artefact-node",
      "source-text",
      "source",
      "result",
      "media-type",
      "display",
      "base-revision"
    ]
  );
});
