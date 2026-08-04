import {
  AGENT_HTTP_PROTOCOL,
  base64Url,
  normalizeAdmissionRequest,
  prefixedRoot,
  rootHex
} from "./protocol.mjs";

function databaseRoot(value, name) {
  return rootHex(value, name);
}

function signPreparedReceipt(signer, prepared) {
  if (!Buffer.isBuffer(prepared.receiptSigningPayload)
      || prepared.receiptSigningPayload.length === 0) {
    throw new Error("database returned invalid receipt signing bytes");
  }
  const signature = signer.sign(prepared.receiptSigningPayload);
  if (!signer.verify(prepared.receiptSigningPayload, signature)) {
    throw new Error("environment receipt signature failed local verification");
  }
  return signature;
}

function publicAdmissionResult(prepared, signedReceiptRootHex, signature) {
  const result = {
    sequence: prepared.sequence,
    receipt_root: prefixedRoot(
      databaseRoot(prepared.receiptRootHex, "admission receipt root")
    ),
    signed_receipt_root: prefixedRoot(
      databaseRoot(signedReceiptRootHex, "signed admission receipt root")
    ),
    environment_signature: base64Url(signature)
  };
  for (const [key, value] of Object.entries(prepared)) {
    if (key === "sequence" || key === "receiptRootHex"
        || key === "receiptSigningPayload" || key.endsWith("_hex")) continue;
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  if (prepared.result_state_root_hex) {
    result.result_state_root = prefixedRoot(
      databaseRoot(prepared.result_state_root_hex, "result state root")
    );
  }
  if (prepared.result_activity_root_hex) {
    result.result_activity_root = prefixedRoot(
      databaseRoot(prepared.result_activity_root_hex, "result activity root")
    );
  }
  return Object.freeze(result);
}

async function verifyRecord(transaction, submission, environmentId, signer) {
  const prepared = await transaction.prepareVerification({
    environmentId,
    packBytes: submission.pack.bytes,
    cellCount: submission.pack.cellCount,
    recordRootHex: submission.recordRootHex,
    recordKind: submission.recordKind
  });
  const signature = signPreparedReceipt(signer, prepared);
  const signedReceiptRootHex = await transaction.commitVerification({
    environmentId,
    recordRootHex: submission.recordRootHex,
    signature
  });
  return Object.freeze({
    sequence: prepared.sequence,
    body_root: prefixedRoot(databaseRoot(prepared.body_root_hex, "record body root")),
    signer_key_root: prefixedRoot(
      databaseRoot(prepared.signer_key_root_hex, "record signer key root")
    ),
    receipt_root: prefixedRoot(
      databaseRoot(prepared.receiptRootHex, "verification receipt root")
    ),
    signed_receipt_root: prefixedRoot(
      databaseRoot(signedReceiptRootHex, "signed verification receipt root")
    ),
    environment_signature: base64Url(signature)
  });
}

async function admitRecord(transaction, submission, environmentId, signer) {
  let prepared;
  let commit;
  const common = {
    environmentId,
    recordRootHex: submission.recordRootHex
  };
  if (submission.recordKind === "profile/version") {
    prepared = await transaction.prepareProfile(common);
    commit = (signature) => transaction.commitProfile({ ...common, signature });
  } else if (submission.recordKind === "room/version") {
    prepared = await transaction.prepareRoomGenesis(common);
    commit = (signature) => transaction.commitRoomGenesis({ ...common, signature });
  } else if (submission.recordKind === "room/invitation") {
    prepared = await transaction.prepareInvitation(common);
    commit = (signature) => transaction.commitInvitation({ ...common, signature });
  } else if (submission.recordKind === "room/admission-proof") {
    prepared = await transaction.prepareMember({
      ...common,
      capability: submission.capability
    });
    commit = (signature) => transaction.commitMember({ ...common, signature });
  } else if (submission.recordKind === "room/document-attachment"
      || submission.recordKind === "room/message-intent") {
    prepared = await transaction.prepareActivity(common);
    commit = (signature) => transaction.commitActivity({ ...common, signature });
  } else {
    throw new Error(`unhandled admitted record kind: ${submission.recordKind}`);
  }
  const signature = signPreparedReceipt(signer, prepared);
  return publicAdmissionResult(prepared, await commit(signature), signature);
}

export function createAgentAdmissionService({
  database,
  signer,
  environmentId = process.env.HESTIA_ENVIRONMENT_ID ?? "hestia-local"
}) {
  if (!database?.transaction || !database?.environment) {
    throw new Error("agent gateway requires a PostgreSQL admission database");
  }
  if (!signer?.sign || !signer?.verify || signer.publicKeyBytes?.length !== 32) {
    throw new Error("agent gateway requires an Ed25519 environment signer");
  }
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(environmentId)) {
    throw new Error("invalid Hestia environment identifier");
  }

  async function environment() {
    const row = await database.environment(environmentId);
    if (!row) throw new Error("Hestia environment signer is not registered");
    const expected = signer.publicKeyBytes.toString("hex");
    if (row.public_key_hex !== expected) {
      throw new Error("registered Hestia environment signer does not match the local key");
    }
    return Object.freeze({
      environment_id: environmentId,
      key_root: prefixedRoot(databaseRoot(row.key_root_hex, "environment key root")),
      public_key: signer.publicKeyBase64Url
    });
  }

  return Object.freeze({
    environment,

    async health() {
      return {
        ok: true,
        protocol: AGENT_HTTP_PROTOCOL,
        environment: await environment()
      };
    },

    async admit(input) {
      const submission = normalizeAdmissionRequest(input);
      const result = await database.transaction(async (transaction) => {
        const verification = await verifyRecord(
          transaction,
          submission,
          environmentId,
          signer
        );
        const admission = await admitRecord(
          transaction,
          submission,
          environmentId,
          signer
        );
        return { verification, admission };
      });
      return Object.freeze({
        ok: true,
        protocol: AGENT_HTTP_PROTOCOL,
        request_id: submission.requestId,
        record_root: prefixedRoot(submission.recordRootHex),
        record_kind: submission.recordKind,
        environment: await environment(),
        verification: result.verification,
        admission: result.admission
      });
    },

    async close() {
      await database.close?.();
    }
  });
}
