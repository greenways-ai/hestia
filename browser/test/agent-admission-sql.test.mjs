import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804010000_agent_record_verification.sql",
  import.meta.url
);

async function sources() {
  const [sql, portableHal, browserHcv1] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL(
      "../../gwdb-ledger-hal/src/gw/ledger/agent_room.hal",
      import.meta.url
    ), "utf8"),
    readFile(new URL("../src/agent-hcv1.js", import.meta.url), "utf8")
  ]);
  return { sql, portableHal, browserHcv1 };
}

test("database verification imports HCP1 and verifies exact GWAR1 Ed25519 bytes", async () => {
  const { sql } = await sources();
  assert.match(sql, /snapshot_pack_import\(p_pack, p_cell_count\)/);
  assert.match(sql, /GWAR1:' \|\| p_record_kind \|\| ':' \|\| encode\(v_body_root, 'hex'\)/);
  assert.match(sql, /gw_ledger\.signature_verify\(/);
  assert.match(sql, /octet_length\(v_signer_public_key\) <> 32/);
  assert.match(sql, /octet_length\(v_signature\) <> 64/);
  assert.match(sql, /signed record payload\/reference mismatch/);
  assert.match(sql, /agent record body payload\/reference mismatch/);
});

test("environment receipt signing is two-stage and cannot accept an arbitrary key", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE TABLE hestia\.environment_signer/);
  assert.match(sql, /environment_signer_one_active_idx/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_record_verify_prepare/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_record_verify_commit/);
  assert.match(sql, /prepared Hestia environment signer is no longer active/);
  assert.match(sql, /invalid Hestia environment receipt signature/);
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.environment_signer_register[^;]+TO hestia_app/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_record_verify_prepare[^;]+TO hestia_app/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_record_verify_commit[^;]+TO hestia_app/
  );
});

test("portable HAL, browser HCV1, and SQL share verification receipt roles", async () => {
  const { sql, portableHal, browserHcv1 } = await sources();
  const roles = [
    "record",
    "body",
    "signer-key",
    "environment-key",
    "outcome",
    "sequence"
  ];
  for (const role of roles) {
    assert.match(sql, new RegExp(`'${role}'`));
    assert.match(portableHal, new RegExp(`\\"${role}\\"`));
  }
  assert.match(sql, /ledger\/verification-receipt/);
  assert.match(portableHal, /ledger\/verification-receipt/);
  assert.match(browserHcv1, /signer_key_root/);
  assert.match(browserHcv1, /rawEd25519PublicKey/);
});

test("application role receives no direct projection writes", async () => {
  const { sql } = await sources();
  assert.match(sql, /REVOKE ALL ON hestia\.agent_record_verification FROM PUBLIC/);
  assert.match(sql, /GRANT SELECT ON hestia\.agent_record_verification TO hestia_app/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]+TO hestia_app/);
});
