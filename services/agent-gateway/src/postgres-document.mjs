import postgres from "postgres";

function requiredUrl(value) {
  if (!value) throw new Error("HESTIA_DATABASE_URL is required");
  return value;
}

function one(rows, operation) {
  if (rows.length !== 1) throw new Error(`${operation} returned ${rows.length} rows`);
  return rows[0];
}

function bytes(hex, name) {
  if (!/^[0-9a-f]{64}$/.test(String(hex || ""))) throw new Error(`invalid ${name}`);
  return Buffer.from(hex, "hex");
}

function optionalBytes(hex, name) {
  return hex == null ? null : bytes(hex, name);
}

function sequence(value, name, allowZero = false) {
  const text = String(value ?? "");
  const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (!pattern.test(text)) throw new Error(`invalid ${name}`);
  return text;
}

function verificationResult(row) {
  return Object.freeze({
    sequence: sequence(row.sequence, "document verification sequence"),
    bodyRootHex: row.body_root_hex,
    signerKeyRootHex: row.signer_key_root_hex,
    receiptRootHex: row.receipt_root_hex,
    receiptSigningPayload: Buffer.from(row.receipt_signing_payload_hex, "hex")
  });
}

function preparedRevision(row, conflict) {
  return Object.freeze({
    documentId: row.document_id,
    outcome: row.outcome,
    sequence: sequence(row.import_sequence, "document import sequence"),
    revision: row.result_revision == null
      ? null
      : sequence(row.result_revision, "document result revision"),
    revisionRootHex: row.revision_root_hex || null,
    resultAstRootHex: row.result_ast_root_hex,
    receiptRootHex: row.receipt_root_hex,
    receiptSigningPayload: Buffer.from(row.receipt_signing_payload_hex, "hex"),
    conflict: conflict || null
  });
}

function adapter(sql) {
  return Object.freeze({
    async prepareDocumentRecordVerification({
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
        FROM hestia.document_record_verify_prepare(
          ${environmentId},
          ${Buffer.from(packBytes)},
          ${cellCount}::bigint,
          ${bytes(recordRootHex, "document record root")},
          ${recordKind}
        )
      `;
      return verificationResult(one(rows, "document verification prepare"));
    },

    async commitDocumentRecordVerification({ environmentId, recordRootHex, signature }) {
      const rows = await sql`
        SELECT encode(
          hestia.document_record_verify_commit(
            ${environmentId},
            ${bytes(recordRootHex, "document record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "document verification commit").signed_receipt_root_hex;
    },

    async documentHead(documentId) {
      const rows = await sql`
        SELECT
          head.current_revision::text AS revision,
          encode(head.current_revision_root, 'hex') AS revision_root_hex,
          encode(head.current_ast_root, 'hex') AS ast_root_hex,
          revision.result_ast_projection AS ast
        FROM hestia.document_head AS head
        LEFT JOIN hestia.document_revision AS revision
          ON revision.document_id = head.document_id
         AND revision.revision = head.current_revision
        WHERE head.document_id = ${documentId}
      `;
      if (!rows.length) return null;
      const row = one(rows, "document head");
      return Object.freeze({
        revision: sequence(row.revision, "document head revision", true),
        revisionRoot: row.revision_root_hex ? `sha256:${row.revision_root_hex}` : null,
        astRoot: `sha256:${row.ast_root_hex}`,
        ast: row.ast
      });
    },

    async documentOperationsAfter({ documentId, revision }) {
      const rows = await sql`
        SELECT
          encode(operation_root, 'hex') AS operation_root_hex,
          operation_projection
        FROM hestia.document_operation_projection
        WHERE document_id = ${documentId}
          AND revision > ${revision}::bigint
        ORDER BY revision, operation_index
      `;
      return rows.map((row) => Object.freeze({
        root: `sha256:${row.operation_root_hex}`,
        operation: row.operation_projection
      }));
    },

    async prepareDocumentRevision({
      environmentId,
      batchRecordRootHex,
      transformationRecordRootHex,
      expectedCurrentRevision,
      expectedCurrentRevisionRootHex,
      expectedCurrentAstRootHex,
      transformedOperations,
      resultAst,
      conflict
    }) {
      const rows = await sql`
        SELECT
          document_id,
          outcome,
          import_sequence::text AS import_sequence,
          result_revision::text AS result_revision,
          encode(revision_root, 'hex') AS revision_root_hex,
          encode(result_ast_root, 'hex') AS result_ast_root_hex,
          encode(import_receipt_root, 'hex') AS receipt_root_hex,
          encode(receipt_signing_payload, 'hex') AS receipt_signing_payload_hex
        FROM hestia.document_batch_prepare(
          ${environmentId},
          ${bytes(batchRecordRootHex, "batch record root")},
          ${bytes(transformationRecordRootHex, "transformation record root")},
          ${expectedCurrentRevision}::bigint,
          ${optionalBytes(expectedCurrentRevisionRootHex, "current revision root")},
          ${bytes(expectedCurrentAstRootHex, "current AST root")},
          ${sql.json(transformedOperations)},
          ${sql.json(resultAst)},
          ${conflict == null ? null : sql.json(conflict)}
        )
      `;
      return preparedRevision(one(rows, "document revision prepare"), conflict);
    },

    async commitDocumentRevision({
      environmentId,
      batchRecordRootHex,
      transformationRecordRootHex,
      signature
    }) {
      const rows = await sql`
        SELECT encode(
          hestia.document_batch_commit(
            ${environmentId},
            ${bytes(batchRecordRootHex, "batch record root")},
            ${bytes(transformationRecordRootHex, "transformation record root")},
            ${Buffer.from(signature)}
          ),
          'hex'
        ) AS signed_receipt_root_hex
      `;
      return one(rows, "document revision commit").signed_receipt_root_hex;
    }
  });
}

export function createPostgresDocumentDatabase({
  url = process.env.HESTIA_DATABASE_URL,
  maxConnections = Number(process.env.HESTIA_DOCUMENT_DATABASE_CONNECTIONS ?? 4)
} = {}) {
  const sql = postgres(requiredUrl(url), {
    max: Math.max(1, Math.min(maxConnections, 16)),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {}
  });
  return Object.freeze({
    async documentTransaction(operation) {
      return sql.begin(async (transaction) => operation(adapter(transaction)));
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  });
}
