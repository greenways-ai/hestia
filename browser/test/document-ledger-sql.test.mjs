import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804050000_document_ot_ledger.sql",
  import.meta.url
);

async function sources() {
  const [sql, hal, service, records] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL(
      "../../gwdb-ledger-hal/src/gw/ledger/document_ot.hal",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../services/agent-gateway/src/document-ledger-service.mjs",
      import.meta.url
    ), "utf8"),
    readFile(new URL("../src/document-hcv1.js", import.meta.url), "utf8")
  ]);
  return { sql, hal, service, records };
}

test("document signatures use a separate GWDP1 domain with raw body roots", async () => {
  const { sql, hal, records } = await sources();
  assert.match(sql, /convert_to\('GWDP1', 'UTF8'\)/);
  assert.match(sql, /decode\('00', 'hex'\)/);
  assert.match(sql, /\|\| p_body_root/);
  assert.match(sql, /invalid GWDP1 document signature/);
  assert.match(records, /DOCUMENT_SIGNING_DOMAIN = "GWDP1"/);
  assert.match(records, /hexToBytes\(documentRootHex/);
  assert.match(hal, /:domain "GWDP1"/);
  assert.doesNotMatch(sql, /GWAR1:document\//);
});

test("OT revisions and operation identities are anchored to gw_ledger cells", async () => {
  const { sql } = await sources();
  for (const table of [
    "document_record_verification",
    "document_head",
    "document_revision",
    "document_operation_projection",
    "document_batch_admission"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE hestia\\.${table}`));
  }
  assert.match(sql, /revision_root bytea NOT NULL UNIQUE REFERENCES gw_ledger\."Cell"\(hash\)/);
  assert.match(sql, /operation_root bytea NOT NULL UNIQUE REFERENCES gw_ledger\."Cell"\(hash\)/);
  assert.match(sql, /transformed_operations_root bytea NOT NULL REFERENCES gw_ledger\."Cell"\(hash\)/);
  assert.match(sql, /result_ast_root bytea NOT NULL REFERENCES gw_ledger\."Cell"\(hash\)/);
  assert.match(sql, /operation_projection jsonb NOT NULL/);
  assert.match(sql, /operation_root is the authoritative HCV1 identity/i);
});

test("prepare and commit recheck the exact head and delegated edit authority", async () => {
  const { sql, service } = await sources();
  assert.match(sql, /document head changed before ledger preparation/);
  assert.match(sql, /document head changed after transformation preparation/);
  assert.match(sql, /document batch lacks current delegated edit authority/);
  assert.match(sql, /document author authority changed after preparation/);
  assert.match(sql, /'document\.edit'/);
  assert.match(sql, /document transformation is not signed by the active environment/);
  assert.match(service, /prepareDocumentRevision/);
  assert.match(service, /signPrepared\(signer, prepared\)/);
  assert.match(service, /commitDocumentRevision/);
});

test("Hara owns the transformation rules including embedded artefact invalidation", async () => {
  const { hal } = await sources();
  assert.match(hal, /\(defn transform-text-splice/);
  assert.match(hal, /\(defn transform-artefact-commit/);
  assert.match(hal, /artefact source changed after the batch base/);
  assert.match(hal, /competing artefact results/);
  assert.match(hal, /\(defn transform-batch/);
  assert.match(hal, /\(defn admission-valid\?/);
});

test("application role can call admissions but cannot mutate canonical projections", async () => {
  const { sql } = await sources();
  for (const table of [
    "document_record_verification",
    "document_head",
    "document_revision",
    "document_operation_projection",
    "document_batch_admission"
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON hestia\\.${table} FROM PUBLIC`));
  }
  assert.match(sql, /GRANT EXECUTE ON FUNCTION hestia\.document_batch_prepare/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION hestia\.document_batch_commit/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE) ON hestia\.document_/);
  assert.match(sql, /document_revision_no_update/);
  assert.match(sql, /document_operation_projection_no_update/);
});
