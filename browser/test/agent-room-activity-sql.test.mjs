import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804040000_agent_room_activity_admission.sql",
  import.meta.url
);

async function sources() {
  const [sql, portableHal, roomRecords, gateway, bootstrap] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL(
      "../../gwdb-ledger-hal/src/gw/ledger/agent_room.hal",
      import.meta.url
    ), "utf8"),
    readFile(new URL("../src/agent-room-records.js", import.meta.url), "utf8"),
    readFile(new URL(
      "../../services/agent-gateway/src/admission-service.mjs",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../services/agent-gateway/src/bootstrap.mjs",
      import.meta.url
    ), "utf8")
  ]);
  return { sql, portableHal, roomRecords, gateway, bootstrap };
}

function tableDefinition(sql, table) {
  const match = new RegExp(
    `CREATE TABLE hestia\\.${table} \\(([\\s\\S]*?)\\n\\);`
  ).exec(sql);
  assert.ok(match, `missing ${table}`);
  return match[1];
}

test("room governance and activity advance on independent canonical heads", async () => {
  const { sql } = await sources();
  assert.match(sql, /ADD COLUMN activity_sequence bigint NOT NULL DEFAULT 0/);
  assert.match(sql, /ADD COLUMN activity_head_root bytea/);
  assert.match(sql, /CREATE TABLE hestia\.agent_room_activity/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_activity_prepare/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_activity_commit/);
  assert.match(sql, /room\/activity-state/);
  assert.match(sql, /v_room\.current_state_root/);
  assert.match(sql, /v_previous_activity_ref/);
  assert.match(sql, /activity_sequence = v_row\.activity_sequence/);
  assert.match(sql, /activity_head_root = v_row\.activity_root/);
  assert.doesNotMatch(
    /UPDATE hestia\.agent_room AS room[\s\S]*?WHERE room\.room_id = v_row\.room_id;/.exec(sql)?.[0] ?? "",
    /current_state_root =/
  );
});

test("document admission verifies nested signature, authority, policy, and predecessor", async () => {
  const { sql } = await sources();
  assert.match(sql, /agent_signed_record_check\([\s\S]*?'document\/version'/);
  assert.match(sql, /document version and attachment must use the same operational key/);
  assert.match(sql, /'document\.attach'/);
  assert.match(sql, /document attachment does not bind the active document policy/);
  assert.match(sql, /document\/content/);
  assert.match(sql, /document version does not bind the latest attached version/);
  assert.match(sql, /first attached document version must be sequence one/);
  assert.match(sql, /UNIQUE \(room_id, document_id, document_version\)/);
});

test("message intent verifies nested ciphertext envelope at the current epoch", async () => {
  const { sql } = await sources();
  assert.match(sql, /agent_signed_record_check\([\s\S]*?'room\/message'/);
  assert.match(sql, /message intent is not bound to the current membership epoch/);
  assert.match(sql, /room message and intent must use the same operational key/);
  assert.match(sql, /message intent ciphertext root does not match its envelope/);
  assert.match(sql, /room\/ciphertext/);
  assert.match(sql, /message ciphertext commitment does not match its envelope/);
  assert.match(sql, /octet_length\(hestia\.base64url_decode\(v_nested_iv\)\) <> 12/);
  assert.match(sql, /message-intent-commit-before-delivery/);
  assert.match(sql, /delivery_status text NOT NULL DEFAULT 'pending-delivery'/);

  const projection = tableDefinition(sql, "agent_room_message_intent");
  assert.doesNotMatch(projection, /^\s*(plaintext|ciphertext|iv)\s+/m);
  assert.match(projection, /^\s*ciphertext_root bytea/m);
});

test("activity commit rechecks room, profile, membership, nested signature, and subject head", async () => {
  const { sql } = await sources();
  assert.match(sql, /room governance or activity head changed after preparation/);
  assert.match(sql, /room activity actor profile changed after preparation/);
  assert.match(sql, /room membership authority changed after activity preparation/);
  assert.match(sql, /room activity actor no longer has delegated authority/);
  assert.match(sql, /nested room activity signature changed after preparation/);
  assert.match(sql, /document head changed after activity preparation/);
  assert.match(sql, /room message appeared after activity preparation/);
  assert.match(sql, /environment_admission_signed_record_put/);
});

test("portable HAL, browser bundles, database policy, and gateway share the activity contract", async () => {
  const { sql, portableHal, roomRecords, gateway, bootstrap } = await sources();
  const roles = [
    "room-state",
    "previous-activity",
    "event",
    "activity-kind",
    "actor-profile",
    "membership-epoch",
    "sequence"
  ];
  for (const role of roles) {
    assert.match(sql, new RegExp(`'${role}'`));
    assert.match(portableHal, new RegExp(`\\"${role}\\"`));
  }
  assert.match(roomRecords, /createDocumentAttachmentBundle/);
  assert.match(roomRecords, /createMessageIntentBundle/);
  assert.match(roomRecords, /sealRoomMessageBundle/);
  assert.match(gateway, /prepareActivity/);
  assert.match(gateway, /commitActivity/);
  assert.match(gateway, /result_activity_root/);
  assert.match(bootstrap, /roomActivityPolicyRoots/);
  assert.match(bootstrap, /environment_room_activity_policy_register/);
});

test("application role can admit activities but cannot write their projections", async () => {
  const { sql } = await sources();
  for (const table of [
    "agent_room_activity",
    "agent_room_document_attachment",
    "agent_room_message_intent",
    "agent_room_activity_admission"
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON hestia\\.${table} FROM PUBLIC`));
    assert.match(sql, new RegExp(`GRANT SELECT ON hestia\\.${table} TO hestia_app`));
  }
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]+TO hestia_app/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_activity_prepare\(text, bytea\) TO hestia_app/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_activity_commit\(text, bytea, bytea\) TO hestia_app/
  );
});
