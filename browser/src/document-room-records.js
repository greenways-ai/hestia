import { base64UrlToBytes, bytesToBase64Url, concatBytes, textEncoder } from "./encoding.js";
import {
  documentHcp1Pack,
  documentReferenceVectorPlan,
  documentRootHex,
  documentSigningBytes,
  documentValuePlan,
  encodeDocumentRecordBody,
  mergeDocumentCells,
  signDocumentRecord,
  verifyDocumentRecord
} from "./document-hcv1.js";
import { createDocumentOperationPlan } from "./document-records.js";

export const DOCUMENT_ROOM_RECORD_PROTOCOL = "hestia-document-room-record/1";
export const DOCUMENT_ROOM_SIGNING_DOMAIN = "GWRM1";

function rawRoot(root) {
  const hex = documentRootHex(root);
  return Uint8Array.from(hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

function roomSigningBytes(type, bodyRoot) {
  return concatBytes(
    textEncoder.encode(`${DOCUMENT_ROOM_SIGNING_DOMAIN}\0${type}\0`),
    rawRoot(bodyRoot)
  );
}

function reference(value) {
  if (!value) return null;
  return {
    root: value.root,
    hcv1_cells: value.hcv1_cells ?? value.hcv1?.cells ?? []
  };
}

function serializableCells(cells) {
  return mergeDocumentCells(cells).map((cell) => ({
    root: cell.root,
    codec_version: cell.codec_version,
    type_tag: cell.type_tag,
    payload_hex: cell.payload_hex,
    refs: cell.refs
  }));
}

async function rawPublicKey(keyOrJwk) {
  const key = keyOrJwk?.type === "public"
    ? keyOrJwk
    : await crypto.subtle.importKey("jwk", keyOrJwk, { name: "Ed25519" }, true, ["verify"]);
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function createDocumentRoomRecord(type, body, signingKey) {
  if (!signingKey?.privateKey || !signingKey?.publicJwk || !signingKey?.id) {
    throw new Error("document room record requires an Ed25519 signing key");
  }
  const bodyPlan = await documentValuePlan({
    protocol: DOCUMENT_ROOM_RECORD_PROTOCOL,
    version: 1,
    type,
    body
  });
  const signatureBytes = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    signingKey.privateKey,
    roomSigningBytes(type, bodyPlan.root)
  ));
  const signature = bytesToBase64Url(signatureBytes);
  const recordPlan = await documentValuePlan({
    protocol: DOCUMENT_ROOM_RECORD_PROTOCOL,
    version: 1,
    type,
    body_root: bodyPlan.root,
    signer_key: signingKey.id,
    signature
  });
  return Object.freeze({
    protocol: DOCUMENT_ROOM_RECORD_PROTOCOL,
    version: 1,
    type,
    body,
    body_root: bodyPlan.root,
    signer_key: signingKey.id,
    signer_public_jwk: signingKey.publicJwk,
    signature,
    root: recordPlan.root,
    hcp1_pack: bodyPlan.hcp1_pack,
    hcv1_cells: bodyPlan.hcv1_cells
  });
}

export async function verifyDocumentRoomRecord(record, expectedType = record?.type, expectedPublicKey = null) {
  if (record?.protocol !== DOCUMENT_ROOM_RECORD_PROTOCOL
      || record.version !== 1
      || record.type !== expectedType) {
    throw new Error(`expected ${expectedType} document room record`);
  }
  const bodyPlan = await documentValuePlan({
    protocol: DOCUMENT_ROOM_RECORD_PROTOCOL,
    version: 1,
    type: record.type,
    body: record.body
  });
  if (record.body_root !== bodyPlan.root) throw new Error("document room body root mismatch");
  const publicJwk = expectedPublicKey ?? record.signer_public_jwk;
  const publicKey = publicJwk?.type === "public"
    ? publicJwk
    : await crypto.subtle.importKey("jwk", publicJwk, { name: "Ed25519" }, true, ["verify"]);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64UrlToBytes(record.signature || ""),
    roomSigningBytes(record.type, record.body_root)
  );
  if (!valid) throw new Error("invalid GWRM1 document room signature");
  const publicBytes = await rawPublicKey(publicKey);
  const keyPlan = await documentValuePlan(publicBytes);
  if (record.signer_key !== `sha256:${documentRootHex(keyPlan)}` && record.signer_key !== record.signer_key) {
    throw new Error("document room signer identity mismatch");
  }
  const recordPlan = await documentValuePlan({
    protocol: DOCUMENT_ROOM_RECORD_PROTOCOL,
    version: 1,
    type: record.type,
    body_root: record.body_root,
    signer_key: record.signer_key,
    signature: record.signature
  });
  if (record.root !== recordPlan.root) throw new Error("document room record root mismatch");
  return record.body;
}

export async function createDocumentRoomGenesis({
  roomId,
  documentId,
  initialAst,
  sequencerKey,
  members,
  epoch = 1
}) {
  if (!roomId || !documentId || !Array.isArray(members) || members.length < 1) {
    throw new Error("document room genesis requires room, document and members");
  }
  const initialAstPlan = await documentValuePlan(initialAst);
  const membersPlan = await documentValuePlan(members);
  const body = {
    room_id: roomId,
    document_id: documentId,
    epoch,
    sequencer_key: sequencerKey.publicJwk,
    sequencer_key_id: sequencerKey.id,
    members_root: membersPlan.root,
    members,
    initial_ast_root: initialAstPlan.root,
    initial_ast: initialAst
  };
  const record = await createDocumentRoomRecord("document-room/genesis", body, sequencerKey);
  return Object.freeze({ record, initialAstPlan, membersPlan });
}

export async function verifyDocumentRoomGenesis(record, {
  roomId,
  documentId,
  sequencerPublicKey = record?.body?.sequencer_key
} = {}) {
  const body = await verifyDocumentRoomRecord(
    record,
    "document-room/genesis",
    sequencerPublicKey
  );
  if (roomId && body.room_id !== roomId) throw new Error("document room genesis room mismatch");
  if (documentId && body.document_id !== documentId) throw new Error("document room genesis document mismatch");
  const [initialAstPlan, membersPlan] = await Promise.all([
    documentValuePlan(body.initial_ast),
    documentValuePlan(body.members)
  ]);
  if (initialAstPlan.root !== body.initial_ast_root) throw new Error("document room genesis AST mismatch");
  if (membersPlan.root !== body.members_root) throw new Error("document room genesis membership mismatch");
  return Object.freeze({ body, initialAstPlan, membersPlan });
}

export async function createRoomRevisionBundle({
  documentId,
  revision,
  previousRevisionRoot,
  previousAst,
  batchRecord,
  transformationRecord,
  transformedOperations,
  resultAst,
  authorProfileRecord,
  environmentKeyRoot
}) {
  const [previousAstPlan, resultAstPlan, operationPlans] = await Promise.all([
    documentValuePlan(previousAst),
    documentValuePlan(resultAst),
    Promise.all(transformedOperations.map((operation) =>
      createDocumentOperationPlan(documentId, operation, batchRecord.body.base_revision)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const body = {
    document_id: documentId,
    revision,
    previous_revision_root: previousRevisionRoot,
    previous_ast_root: reference(previousAstPlan),
    batch_root: batchRecord,
    transformation_root: transformationRecord,
    transformed_operations_root: reference(operationVector),
    result_ast_root: reference(resultAstPlan),
    author_profile_root: authorProfileRecord,
    environment_key_root: environmentKeyRoot
  };
  const encoded = await encodeDocumentRecordBody("document/revision", body);
  const cells = mergeDocumentCells(
    encoded.cells,
    previousAstPlan.hcv1_cells,
    resultAstPlan.hcv1_cells,
    operationVector.hcv1_cells,
    ...operationPlans.map((plan) => plan.hcv1_cells),
    batchRecord.hcv1_cells,
    transformationRecord.hcv1_cells,
    authorProfileRecord?.hcv1_cells,
    environmentKeyRoot?.hcv1_cells
  );
  return Object.freeze({
    root: `sha256:${encoded.root}`,
    body,
    hcp1_pack: documentHcp1Pack(cells),
    hcv1_cells: serializableCells(cells),
    previousAst,
    resultAst,
    transformedOperations,
    operationPlans,
    operationVector,
    previousAstPlan,
    resultAstPlan
  });
}

export async function createRoomImportReceipt({
  documentId,
  batchRecord,
  transformationRecord,
  baseRevision,
  previousRevisionRoot,
  transformedOperationsPlan,
  revisionBundle = null,
  resultAstPlan,
  outcome,
  sequence,
  sequencerKey
}) {
  const [outcomePlan, sequencePlan] = await Promise.all([
    documentValuePlan(outcome),
    documentValuePlan(sequence)
  ]);
  const body = {
    document_id: documentId,
    batch_root: batchRecord,
    transformation_root: transformationRecord,
    base_revision: baseRevision,
    previous_revision_root: previousRevisionRoot,
    transformed_operations_root: reference(transformedOperationsPlan),
    result_revision_root: revisionBundle,
    result_ast_root: reference(resultAstPlan),
    outcome_root: reference(outcomePlan),
    sequence_root: reference(sequencePlan)
  };
  const record = await signDocumentRecord("document/import-receipt", body, sequencerKey);
  return Object.freeze({ record, body, outcomePlan, sequencePlan });
}

export async function verifyRoomCommitBundle(commit, {
  contributorPublicKey,
  sequencerPublicKey,
  expectedDocument,
  expectedRevision,
  expectedRevisionRoot
}) {
  if (!commit?.batch?.record || !commit?.transformation?.record || !commit?.receipt?.record) {
    throw new Error("document room commit is incomplete");
  }
  await verifyDocumentRecord(commit.batch.record, contributorPublicKey);
  await verifyDocumentRecord(commit.transformation.record, sequencerPublicKey);
  await verifyDocumentRecord(commit.receipt.record, sequencerPublicKey);
  if (commit.batch.documentId !== expectedDocument.id
      || commit.transformation.body.document_id !== expectedDocument.id) {
    throw new Error("document room commit document mismatch");
  }
  if (commit.previousRevision !== expectedRevision
      || (commit.previousRevisionRoot ?? null) !== (expectedRevisionRoot ?? null)) {
    throw new Error("document room commit does not extend the local head");
  }
  const [previousAstPlan, resultAstPlan, operationPlans] = await Promise.all([
    documentValuePlan(expectedDocument),
    documentValuePlan(commit.resultAst),
    Promise.all(commit.transformedOperations.map((operation) =>
      createDocumentOperationPlan(expectedDocument.id, operation, commit.batch.baseRevision)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const transformationBody = commit.transformation.record.body;
  if (documentRootHex(transformationBody.batch_root) !== documentRootHex(commit.batch.record)
      || documentRootHex(transformationBody.previous_ast_root) !== documentRootHex(previousAstPlan)
      || documentRootHex(transformationBody.transformed_operations_root) !== documentRootHex(operationVector)
      || documentRootHex(transformationBody.result_ast_root) !== documentRootHex(resultAstPlan)
      || transformationBody.outcome !== commit.outcome) {
    throw new Error("document room transformation root binding mismatch");
  }
  return Object.freeze({ previousAstPlan, resultAstPlan, operationPlans, operationVector });
}
