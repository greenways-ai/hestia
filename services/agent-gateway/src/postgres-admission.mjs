import postgres from "postgres";

function requiredUrl(value) {
  if (!value) throw new Error("HESTIA_DATABASE_URL is required");
  return value;
}

function one(rows, operation) {
  if (rows.length !== 1) {
    throw new Error(`${operation} returned ${rows.length} rows`);
  }
  return rows[0];
}

function bytes(hex, name) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`invalid ${name}`);
  return Buffer.from(hex, "hex");
}

function sequence(value, name) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`invalid ${name}`);
  return text;
}

function prepareResult(row, operation) {
  return Object.freeze({
    ...row,
    sequence: sequence(row.sequence, `${operation} sequence`),
    receiptRootHex: row.receipt_root_hex,
    receiptSigningPayload: Buffer.from(row.receipt_signing_payload_hex, "hex")
  });
}

function transactionAdapter(sql) {
  return Object.freeze({
    async prepareVerification({
      environmentId,
      packBytes,
      cellCount,
      recordRootHex,
      recordKind
    }) {
      const rows = await sql`
        SELECT
          sequence::text AS sequence,
          encode(body_root, 'hex') AS body_root_hex,
          encode(signer_key_root, 'hex') AS signer_key_root_hex,
          encode(verification_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_record_verify_prepare(
          ${environmentId},
          ${packBytes},
          ${cellCount}::bigint,
          ${bytes(recordRootHex, "record root")},
          ${recordKind}
        )
      `;
      return prepareResult(one(rows, "record verification prepare"), "verification");
    },

    async commitVerification({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_record_verify_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "record verification commit").signed_receipt_root_hex;
    },

    async prepareProfile({ environmentId, recordRootHex }) {
      const rows = await sql`
        SELECT
          admission_sequence::text AS sequence,
          profile_id,
          profile_sequence::text AS profile_sequence,
          encode(result_state_root, 'hex') AS result_state_root_hex,
          encode(admission_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_profile_admit_prepare(
          ${environmentId},
          ${bytes(recordRootHex, "record root")}
        )
      `;
      return prepareResult(one(rows, "profile admission prepare"), "profile admission");
    },

    async commitProfile({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_profile_admit_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "profile admission commit").signed_receipt_root_hex;
    },

    async prepareRoomGenesis({ environmentId, recordRootHex }) {
      const rows = await sql`
        SELECT
          transition_sequence::text AS sequence,
          room_id,
          encode(result_state_root, 'hex') AS result_state_root_hex,
          encode(admission_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_room_genesis_prepare(
          ${environmentId},
          ${bytes(recordRootHex, "record root")}
        )
      `;
      return prepareResult(one(rows, "room genesis prepare"), "room genesis");
    },

    async commitRoomGenesis({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_room_genesis_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "room genesis commit").signed_receipt_root_hex;
    },

    async prepareInvitation({ environmentId, recordRootHex }) {
      const rows = await sql`
        SELECT
          transition_sequence::text AS sequence,
          invite_id,
          encode(result_room_state_root, 'hex') AS result_state_root_hex,
          encode(admission_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_room_invitation_prepare(
          ${environmentId},
          ${bytes(recordRootHex, "record root")}
        )
      `;
      return prepareResult(one(rows, "room invitation prepare"), "room invitation");
    },

    async commitInvitation({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_room_invitation_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "room invitation commit").signed_receipt_root_hex;
    },

    async prepareMember({ environmentId, recordRootHex, capability }) {
      const rows = await sql`
        SELECT
          transition_sequence::text AS sequence,
          room_id,
          member_profile_id,
          next_membership_epoch::text AS next_membership_epoch,
          encode(result_room_state_root, 'hex') AS result_state_root_hex,
          encode(admission_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_room_member_prepare(
          ${environmentId},
          ${bytes(recordRootHex, "record root")},
          ${Buffer.from(capability)}
        )
      `;
      return prepareResult(one(rows, "room member prepare"), "room member");
    },

    async commitMember({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_room_member_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "room member commit").signed_receipt_root_hex;
    },

    async prepareActivity({ environmentId, recordRootHex }) {
      const rows = await sql`
        SELECT
          prepared_sequence::text AS sequence,
          prepared_activity_kind AS activity_kind,
          prepared_room_id AS room_id,
          encode(result_activity_root, 'hex') AS result_activity_root_hex,
          encode(admission_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.agent_room_activity_prepare(
          ${environmentId},
          ${bytes(recordRootHex, "record root")}
        )
      `;
      return prepareResult(one(rows, "room activity prepare"), "room activity");
    },

    async commitActivity({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.agent_room_activity_commit(
            ${environmentId},
            ${bytes(recordRootHex, "record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "room activity commit").signed_receipt_root_hex;
    }
  });
}

export function createPostgresAdmissionDatabase({
  url = process.env.HESTIA_DATABASE_URL,
  maxConnections = Number(process.env.HESTIA_AGENT_DATABASE_CONNECTIONS ?? 4)
} = {}) {
  const sql = postgres(requiredUrl(url), {
    max: Math.max(1, Math.min(maxConnections, 16)),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {}
  });

  return Object.freeze({
    async transaction(operation) {
      return sql.begin(async (transaction) => operation(transactionAdapter(transaction)));
    },

    async environment(environmentId) {
      const rows = await sql`
        SELECT
          encode(key_root, 'hex') AS key_root_hex,
          encode(public_key, 'hex') AS public_key_hex,
          status
        FROM hestia.environment_signer
        WHERE environment_id = ${environmentId}
          AND status = 'active'
      `;
      return rows.length === 1 ? rows[0] : null;
    },

    async close() {
      await sql.end({ timeout: 5 });
    }
  });
}
