import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804030000_agent_room_membership_admission.sql",
  import.meta.url
);

async function sources() {
  const [sql, portableHal, roomRecords] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL(
      "../../gwdb-ledger-hal/src/gw/ledger/agent_room.hal",
      import.meta.url
    ), "utf8"),
    readFile(new URL("../src/agent-room-records.js", import.meta.url), "utf8")
  ]);
  return { sql, portableHal, roomRecords };
}

function tableDefinition(sql, table) {
  const match = new RegExp(
    `CREATE TABLE hestia\\.${table} \\(([\\s\\S]*?)\\n\\);`
  ).exec(sql);
  assert.ok(match, `missing ${table}`);
  return match[1];
}

test("room admission recomputes capabilities without persisting the secret", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE FUNCTION hestia\.room_capability_commitment_root/);
  assert.match(sql, /CREATE FUNCTION hestia\.room_admission_proof_root/);
  assert.match(sql, /HESTIA-ROOM-CAPABILITY\/1/);
  assert.match(sql, /HESTIA-ROOM-ADMISSION\/1/);
  assert.match(sql, /octet_length\(p_capability\) <> 32/);
  assert.match(sql, /room admission capability does not match the invitation/);
  assert.match(sql, /room admission capability proof mismatch/);
  assert.doesNotMatch(
    tableDefinition(sql, "agent_room_member_admission"),
    /^\s*capability\s+bytea/m
  );
  assert.doesNotMatch(
    tableDefinition(sql, "agent_room_invitation"),
    /^\s*capability\s+bytea/m
  );
});

test("membership admission consumes one invite and rotates the epoch atomically", async () => {
  const { sql } = await sources();
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_genesis_prepare/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_invitation_prepare/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_member_prepare/);
  assert.match(sql, /CREATE FUNCTION hestia\.agent_room_member_commit/);
  assert.match(sql, /member-admit-and-rotate/);
  assert.match(sql, /v_next_membership_epoch := v_room\.membership_epoch \+ 1/);
  assert.match(sql, /SET current_state_root = v_row\.consumed_invitation_state_root/);
  assert.match(sql, /status = 'consumed'/);
  assert.match(sql, /membership_epoch = v_row\.next_membership_epoch/);
  assert.match(sql, /guest profile became a room member after preparation/);
  assert.match(sql, /room invitation changed after member admission preparation/);
});

test("room authority is bound to admitted operational delegations", async () => {
  const { sql } = await sources();
  assert.match(sql, /'room\.create'/);
  assert.match(sql, /'room\.invite'/);
  assert.match(sql, /'room\.join'/);
  assert.match(sql, /v_verification\.signer_key_root <> v_guest\.operational_key_root/);
  assert.match(sql, /room admission proof is not signed by the guest operational key/);
  assert.match(sql, /room invitation is not signed by an authorized host key/);
  assert.match(sql, /room genesis is not signed by an authorized host operational key/);
});

test("portable HAL and PostgreSQL share room projection field order", async () => {
  const { sql, portableHal } = await sources();
  const roles = {
    "profile/state": [
      "profile-id", "sequence", "profile-version", "root-key",
      "operational-key", "delegation", "status"
    ],
    "room/member-state": [
      "room", "member-profile", "role", "purposes", "status",
      "joined-epoch", "revoked-epoch", "delegation"
    ],
    "room/invitation-state": [
      "invitation", "room-state", "status", "consumed-by", "consumed-record"
    ],
    "room/state": [
      "room-id", "room-version", "host-profile", "membership-epoch",
      "members", "invitations", "policy", "kernel", "acceptance-mode", "status"
    ]
  };
  for (const [kind, fields] of Object.entries(roles)) {
    assert.match(sql, new RegExp(kind.replace("/", "\\/")));
    assert.match(portableHal, new RegExp(kind.replace("/", "\\/")));
    for (const field of fields) {
      assert.match(sql, new RegExp(`'${field}'`));
      assert.match(portableHal, new RegExp(`\\"${field}\\"`));
    }
  }
});

test("browser room bundles include companion HCV0 cells in deterministic HCP0", async () => {
  const { roomRecords } = await sources();
  assert.match(roomRecords, /export function agentAdmissionBundle/);
  assert.match(roomRecords, /hcp1Pack\(hcv1Cells\)/);
  assert.match(roomRecords, /createRoomInviteBundle/);
  assert.match(roomRecords, /createAdmissionProofBundle/);
  assert.match(roomRecords, /created\.record\.body\.capability_commitment !== capabilityPlan\.root/);
  assert.match(roomRecords, /record\.body\.capability_proof !== proofPlan\.root/);
});

test("application role can invoke transitions but cannot write projections", async () => {
  const { sql } = await sources();
  for (const table of [
    "agent_room",
    "agent_room_member",
    "agent_room_invitation",
    "agent_room_state_version"
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON hestia\\.${table} FROM PUBLIC`));
    assert.match(sql, new RegExp(`GRANT SELECT ON hestia\\.${table} TO hestia_app`));
  }
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]+TO hestia_app/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_member_prepare\(text, bytea, bytea\) TO hestia_app/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION hestia\.agent_room_member_commit\(text, bytea, bytea\) TO hestia_app/
  );
});
