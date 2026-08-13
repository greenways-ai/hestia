import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260813060000_room_source_grant_admission.sql",
  import.meta.url
);
const hcv1Url = new URL("../src/agent-hcv1.js", import.meta.url);

async function sources() {
  const [sql, hcv1] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(hcv1Url, "utf8")
  ]);
  return { sql, hcv1 };
}

function tableDefinition(sql, table) {
  const match = new RegExp(
    `CREATE TABLE hestia\\.${table} \\(([\\s\\S]*?)\\n\\);`
  ).exec(sql);
  assert.ok(match, `missing ${table}`);
  return match[1];
}

test("SQL and browser HCV1 register the same room authority records", async () => {
  const { sql, hcv1 } = await sources();
  const records = {
    "room/source-mandate": [
      "mandate-id", "room", "governance", "issued-by", "authority",
      "source-id", "source-node", "implementation", "application",
      "operations", "membership-epoch", "policy-revision",
      "requires-user-interaction", "valid-from", "valid-until"
    ],
    "room/source-mandate-revocation": [
      "revocation-id", "room", "governance", "mandate", "revoked-by",
      "authority", "reason", "revoked-at"
    ],
    "room/application-grant": [
      "grant-id", "room", "governance", "issued-by", "authority",
      "member-profile", "member-node", "source-mandate", "application",
      "operations", "limits", "membership-epoch", "policy-revision",
      "valid-from", "valid-until"
    ],
    "room/application-grant-revocation": [
      "revocation-id", "room", "governance", "grant", "revoked-by",
      "authority", "reason", "revoked-at"
    ]
  };

  for (const [kind, roles] of Object.entries(records)) {
    assert.match(sql, new RegExp(kind.replace("/", "\\/")));
    assert.match(hcv1, new RegExp(`\\"${kind.replace("/", "\\/")}\\"`));
    for (const role of roles) {
      assert.match(sql, new RegExp(`'${role}'`));
      assert.match(hcv1, new RegExp(`\\"${role}\\"`));
    }
  }
});

test("room source and grant authority advances a separate canonical subhead", async () => {
  const { sql } = await sources();
  assert.match(sql, /ADD COLUMN authority_policy_revision bigint NOT NULL DEFAULT 1/);
  assert.match(sql, /ADD COLUMN authority_sequence bigint NOT NULL DEFAULT 0/);
  assert.match(sql, /ADD COLUMN authority_head_root bytea/);
  assert.match(sql, /WHEN 'room\/authority-state' THEN/);
  assert.match(sql, /'room\/authority-state',[\s\S]*v_room\.current_state_root/);
  assert.match(sql, /v_room\.authority_head_root/);
  assert.match(sql, /v_room\.membership_epoch/);
  assert.match(sql, /v_room\.authority_policy_revision/);
  assert.doesNotMatch(
    sql,
    /SET current_state_root = v_row\.authority_root/
  );
  assert.doesNotMatch(
    sql,
    /SET activity_head_root = v_row\.authority_root/
  );
});

test("canonical application maps, limits and operations are closed and bounded", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE FUNCTION hestia\.hcv1_map_require_keys/);
  assert.match(sql, /HCV0 map fields do not match the closed schema/);
  assert.match(sql, /CREATE FUNCTION hestia\.hcv1_application_identity/);
  assert.match(sql, /app_id','approval_digest','lock_digest','manifest_digest/);
  assert.match(sql, /application version is not SemVer/);
  assert.match(sql, /CREATE FUNCTION hestia\.hcv1_room_application_limits/);
  assert.match(sql, /requests_per_day NOT BETWEEN 1 AND 1000000/);
  assert.match(sql, /max_timeout_ms NOT BETWEEN 1 AND 86400000/);
  assert.match(sql, /CREATE FUNCTION hestia\.hcv1_authority_operations/);
  assert.match(sql, /room authority operations contain duplicates/);
  assert.match(sql, /room authority operations are not canonically ordered/);
});

test("prepare verifies exact current room, host, member, source and narrowing", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_authority_prepare/);
  assert.match(sql, /room authority does not bind the current governance root/);
  assert.match(sql, /room authority actor is not the current room host/);
  assert.match(sql, /room\.source\.manage/);
  assert.match(sql, /room\.app\.grant/);
  assert.match(sql, /room authority epoch or policy revision is stale/);
  assert.match(sql, /room application grant member is not active or invocable/);
  assert.match(sql, /room application grant source mandate is not active/);
  assert.match(sql, /room application grant changes the source application/);
  assert.match(sql, /room application grant broadens source operations/);
  assert.match(sql, /room application grant exceeds source validity/);
});

test("commit is exact-head compare-and-set and revocation is root-bound", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_authority_commit/);
  assert.match(sql, /room authority head changed after preparation/);
  assert.match(sql, /room authority actor changed after preparation/);
  assert.match(sql, /source mandate changed after revocation preparation/);
  assert.match(sql, /room application grant changed after revocation preparation/);
  assert.match(sql, /WHERE signed_record_root = v_target_record_root/);
  assert.match(sql, /SET authority_sequence = v_row\.authority_sequence/);
  assert.match(sql, /authority_head_root = v_row\.authority_root/);
  assert.match(sql, /environment_admission_signed_record_put/);
});

test("application role receives typed transitions but no projection writes", async () => {
  const { sql } = await sources();
  for (const table of [
    "agent_room_authority",
    "agent_room_source_mandate",
    "agent_room_source_mandate_revocation",
    "agent_room_application_grant",
    "agent_room_application_grant_revocation",
    "agent_room_authority_admission"
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON hestia\\.${table} FROM PUBLIC`));
    assert.match(sql, new RegExp(`GRANT SELECT ON hestia\\.${table} TO hestia_app`));
  }
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]+TO hestia_app/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_authority_prepare\(text, bytea\)/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_authority_commit\(text, bytea, bytea\)/
  );
});

test("room authority projections remain application-specific and secret-free", async () => {
  const { sql } = await sources();
  for (const forbidden of [
    "browser_cookie",
    "provider_credential",
    "private_key",
    "key_store_handle",
    "bearer_token",
    "route_endpoint"
  ]) {
    assert.doesNotMatch(sql, new RegExp(forbidden));
  }
  assert.doesNotMatch(sql, /greenways-local-room-authority/);
  assert.doesNotMatch(sql, /provider\.invoke/);
});

test("authority projections retain exact canonical record and receipt roots", async () => {
  const { sql } = await sources();
  for (const table of [
    "agent_room_source_mandate",
    "agent_room_source_mandate_revocation",
    "agent_room_application_grant",
    "agent_room_application_grant_revocation"
  ]) {
    const definition = tableDefinition(sql, table);
    assert.match(definition, /signed_record_root bytea NOT NULL UNIQUE/);
    assert.match(definition, /body_root bytea NOT NULL/);
    assert.match(definition, /governance_root bytea NOT NULL/);
    assert.match(definition, /authority_root bytea NOT NULL/);
    assert.match(definition, /admission_signed_receipt_root bytea NOT NULL/);
  }
});
