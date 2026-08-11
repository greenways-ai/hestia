import {
  base64UrlToBytes,
  bytesToBase64Url,
  textEncoder
} from "./encoding.js";

export const DOCUMENT_HCV0_PROTOCOL = "greenways-document-hcv1/0-alpha";
export const DOCUMENT_RECORD_PROTOCOL = "greenways-document/0-alpha";
export const DOCUMENT_SIGNING_DOMAIN = "GWDP0";

const TYPE = Object.freeze({
  nil: 0,
  boolean: 1,
  integer: 2,
  string: 5,
  blob: 6,
  vector: 10,
  map: 11,
  record: 14
});

export const DOCUMENT_RECORD_SCHEMAS = Object.freeze({
  "document/text-splice": [
    ["operation-id", "operation_id"],
    ["document-id", "document_id"],
    ["target", "target_id"],
    ["offset", "offset"],
    ["delete-count", "delete_count"],
    ["insert", "insert"],
    ["base-revision", "base_revision"]
  ],
  "document/node-insert": [
    ["operation-id", "operation_id"],
    ["document-id", "document_id"],
    ["parent", "parent_id"],
    ["before", "before_id"],
    ["after", "after_id"],
    ["node", "node_root", "reference"],
    ["base-revision", "base_revision"]
  ],
  "document/node-delete": [
    ["operation-id", "operation_id"],
    ["document-id", "document_id"],
    ["target", "target_id"],
    ["expected", "expected_root", "reference"],
    ["base-revision", "base_revision"]
  ],
  "document/node-set-attrs": [
    ["operation-id", "operation_id"],
    ["document-id", "document_id"],
    ["target", "target_id"],
    ["expected-attrs", "expected_attrs_root", "reference"],
    ["attrs", "attrs_root", "reference"],
    ["base-revision", "base_revision"]
  ],
  "document/artefact-commit": [
    ["operation-id", "operation_id"],
    ["document-id", "document_id"],
    ["artefact-id", "artefact_id"],
    ["artefact-node", "artefact_node_id"],
    ["source-text", "source_text_id"],
    ["source", "source_root", "reference"],
    ["result", "result_root", "reference"],
    ["media-type", "media_type"],
    ["display", "display"],
    ["base-revision", "base_revision"]
  ],
  "document/batch": [
    ["batch-id", "batch_id"],
    ["document-id", "document_id"],
    ["base-revision", "base_revision"],
    ["base-ast", "base_ast_root", "reference"],
    ["operations", "operations_root", "reference"],
    ["expected-result", "expected_result_root", "reference"],
    ["author-profile", "author_profile_root", "reference"],
    ["delegation", "delegation_root", "reference"]
  ],
  "document/transformation": [
    ["transformation-id", "transformation_id"],
    ["document-id", "document_id"],
    ["batch", "batch_root", "reference"],
    ["base-revision", "base_revision"],
    ["previous-revision", "previous_revision_root", "reference"],
    ["previous-ast", "previous_ast_root", "reference"],
    ["transformed-operations", "transformed_operations_root", "reference"],
    ["result-ast", "result_ast_root", "reference"],
    ["outcome", "outcome"],
    ["conflict", "conflict_root", "reference"]
  ],
  "document/revision": [
    ["document-id", "document_id"],
    ["revision", "revision"],
    ["previous-revision", "previous_revision_root", "reference"],
    ["previous-ast", "previous_ast_root", "reference"],
    ["batch", "batch_root", "reference"],
    ["transformation", "transformation_root", "reference"],
    ["transformed-operations", "transformed_operations_root", "reference"],
    ["result-ast", "result_ast_root", "reference"],
    ["author-profile", "author_profile_root", "reference"],
    ["environment-key", "environment_key_root", "reference"]
  ],
  "document/import-receipt": [
    ["document-id", "document_id"],
    ["batch", "batch_root", "reference"],
    ["transformation", "transformation_root", "reference"],
    ["base-revision", "base_revision"],
    ["previous-revision", "previous_revision_root", "reference"],
    ["transformed-operations", "transformed_operations_root", "reference"],
    ["result-revision", "result_revision_root", "reference"],
    ["result-ast", "result_ast_root", "reference"],
    ["outcome", "outcome_root", "reference"],
    ["sequence", "sequence_root", "reference"]
  ],
  "document/verification-receipt": [
    ["record", "record_root", "reference"],
    ["body", "body_root", "reference"],
    ["signer-key", "signer_key_root", "reference"],
    ["environment-key", "environment_key_root", "reference"],
    ["outcome", "outcome_root", "reference"],
    ["sequence", "sequence_root", "reference"]
  ],
  "document/signed-record": [
    ["body", "body_root", "reference"],
    ["signer-key", "signer_key_root", "reference"],
    ["signature", "signature_root", "reference"]
  ]
});

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) {
    throw new Error("invalid lowercase hexadecimal transport");
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function concatBytes(...values) {
  const length = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function compareBytes(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

async function digestHex(bytes) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function envelopeBytes(typeTag, payload) {
  return textEncoder.encode(`HCV0:${typeTag}:${payload.length}:${bytesToHex(payload)}`);
}

function roleRef(position, role, childRoot) {
  return { position, role, child_root: childRoot };
}

async function createCell(typeTag, payload, refs = []) {
  const envelope = envelopeBytes(typeTag, payload);
  return {
    root: await digestHex(envelope),
    codec_version: 1,
    type_tag: typeTag,
    payload_hex: bytesToHex(payload),
    refs,
    envelope
  };
}

export function mergeDocumentCells(...groups) {
  const byRoot = new Map();
  for (const group of groups) {
    for (const cell of group ?? []) byRoot.set(cell.root, cell);
  }
  return [...byRoot.values()];
}

export function documentRootHex(value, name = "HCV0 root") {
  const root = typeof value === "string"
    ? value
    : value?.root ?? value?.body_root ?? value?.hcv1?.root;
  const match = /^(?:sha256:)?([0-9a-f]{64})$/.exec(String(root ?? ""));
  if (!match) throw new Error(`${name} must be a lowercase SHA-256 root`);
  return match[1];
}

function referencedCells(value) {
  return value?.hcv1_cells ?? value?.cells ?? value?.hcv1?.cells ?? [];
}

async function rawEd25519PublicKey(publicKeyOrJwk) {
  if (publicKeyOrJwk instanceof Uint8Array) return new Uint8Array(publicKeyOrJwk);
  const publicKey = publicKeyOrJwk?.type === "public"
    ? publicKeyOrJwk
    : await crypto.subtle.importKey(
      "jwk",
      publicKeyOrJwk,
      { name: "Ed25519" },
      true,
      ["verify"]
    );
  return new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
}

async function encodeReference(value) {
  if (value === undefined || value === null) return encodeDocumentValue(null);
  return {
    root: documentRootHex(value),
    cells: referencedCells(value),
    envelope: null
  };
}

async function encodeVector(values, references = false) {
  const encoded = [];
  for (const value of values) {
    encoded.push(references ? await encodeReference(value) : await encodeDocumentValue(value));
  }
  const payload = textEncoder.encode(`S:${encoded.length}:${encoded.map(({ root }) => root).join("")}`);
  const cell = await createCell(
    TYPE.vector,
    payload,
    encoded.map(({ root }, position) => roleRef(position, "element", root))
  );
  return {
    root: cell.root,
    cell,
    cells: mergeDocumentCells(encoded.flatMap(({ cells }) => cells), [cell]),
    envelope: cell.envelope
  };
}

async function encodeMap(value) {
  const pairs = [];
  for (const [key, item] of Object.entries(value)) {
    pairs.push({ key: await encodeDocumentValue(key), value: await encodeDocumentValue(item) });
  }
  pairs.sort((left, right) => compareBytes(left.key.envelope, right.key.envelope));
  const roots = pairs.flatMap(({ key, value: item }) => [key.root, item.root]);
  const refs = pairs.flatMap(({ key, value: item }, position) => [
    roleRef(position, "key", key.root),
    roleRef(position, "value", item.root)
  ]);
  const cell = await createCell(
    TYPE.map,
    textEncoder.encode(`M:${pairs.length}:${roots.join("")}`),
    refs
  );
  return {
    root: cell.root,
    cell,
    cells: mergeDocumentCells(
      pairs.flatMap(({ key, value: item }) => [...key.cells, ...item.cells]),
      [cell]
    ),
    envelope: cell.envelope
  };
}

export async function encodeDocumentValue(value) {
  let cell;
  if (value === undefined || value === null) {
    cell = await createCell(TYPE.nil, new Uint8Array());
  } else if (typeof value === "boolean") {
    cell = await createCell(TYPE.boolean, new Uint8Array([value ? 1 : 0]));
  } else if (typeof value === "number" || typeof value === "bigint") {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || !Number.isFinite(value))) {
      throw new Error("HCV0 document values require safe integers");
    }
    cell = await createCell(TYPE.integer, textEncoder.encode(String(value)));
  } else if (typeof value === "string") {
    cell = await createCell(TYPE.string, textEncoder.encode(value));
  } else if (value instanceof Uint8Array) {
    cell = await createCell(TYPE.blob, value);
  } else if (Array.isArray(value)) {
    return encodeVector(value);
  } else if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return encodeMap(value);
  } else {
    throw new Error(`unsupported HCV0 document value: ${Object.prototype.toString.call(value)}`);
  }
  return { root: cell.root, cell, cells: [cell], envelope: cell.envelope };
}

export async function encodeDocumentReferenceVector(values) {
  return encodeVector(values, true);
}

function recordPayload(kind, roots) {
  return textEncoder.encode(
    `R:${DOCUMENT_RECORD_PROTOCOL}:${kind}:1:${roots.length}:${roots.join("")}`
  );
}

async function createRecordCell(kind, encodedFields) {
  const schema = DOCUMENT_RECORD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown HCV0 document record kind: ${kind}`);
  if (schema.length !== encodedFields.length) throw new Error(`invalid ${kind} field count`);
  const roots = encodedFields.map(({ root }) => root);
  const cell = await createCell(
    TYPE.record,
    recordPayload(kind, roots),
    schema.map(([role], position) => roleRef(position, role, roots[position]))
  );
  return {
    root: cell.root,
    cell,
    cells: mergeDocumentCells(encodedFields.flatMap(({ cells }) => cells), [cell]),
    envelope: cell.envelope
  };
}

export async function encodeDocumentRecordBody(kind, body) {
  const schema = DOCUMENT_RECORD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown HCV0 document record kind: ${kind}`);
  const fields = [];
  for (const [, property, mode] of schema) {
    const value = body?.[property] ?? null;
    fields.push(mode === "reference"
      ? await encodeReference(value)
      : await encodeDocumentValue(value));
  }
  return createRecordCell(kind, fields);
}

export function documentSigningBytes(kind, bodyRoot) {
  const root = hexToBytes(documentRootHex(bodyRoot, "document body root"));
  return concatBytes(textEncoder.encode(`${DOCUMENT_SIGNING_DOMAIN}\0${kind}\0`), root);
}

function serializableCell(cell) {
  return {
    root: cell.root,
    codec_version: cell.codec_version,
    type_tag: cell.type_tag,
    payload_hex: cell.payload_hex,
    refs: cell.refs
  };
}

export function documentHcp1Pack(cells) {
  const ordered = mergeDocumentCells(cells).sort((left, right) => left.root.localeCompare(right.root));
  return `HCP0:${ordered.length}:` + ordered.map((cell) => {
    const refs = [...cell.refs].sort((left, right) =>
      left.position - right.position || left.role.localeCompare(right.role));
    return `C:${cell.root}:${cell.codec_version}:${cell.type_tag}:${cell.payload_hex}:${refs.length}:`
      + refs.map((ref) =>
        `R:${ref.position}:${bytesToHex(textEncoder.encode(ref.role))}:${ref.child_root}:`
      ).join("");
  }).join("");
}

export async function documentValuePlan(value) {
  const encoded = await encodeDocumentValue(value);
  return {
    root: `sha256:${encoded.root}`,
    hcp1_pack: documentHcp1Pack(encoded.cells),
    hcv1_cells: encoded.cells.map(serializableCell)
  };
}

export async function documentReferenceVectorPlan(values) {
  const encoded = await encodeDocumentReferenceVector(values);
  return {
    root: `sha256:${encoded.root}`,
    hcp1_pack: documentHcp1Pack(encoded.cells),
    hcv1_cells: encoded.cells.map(serializableCell)
  };
}

async function assembleSignedRecord(kind, body, signer, signerKeyId = null) {
  if (!signer?.sign || !(signer.publicKeyBytes instanceof Uint8Array)) {
    throw new Error("document signer requires sign(payload) and publicKeyBytes");
  }
  const bodyPlan = await encodeDocumentRecordBody(kind, body);
  const signatureBytes = new Uint8Array(await signer.sign(documentSigningBytes(kind, bodyPlan.root)));
  if (signatureBytes.length !== 64) throw new Error("document signature must be 64 bytes");
  const signerKey = await encodeDocumentValue(signer.publicKeyBytes);
  const signature = await encodeDocumentValue(signatureBytes);
  const signed = await createRecordCell("document/signed-record", [
    { root: bodyPlan.root, cells: bodyPlan.cells },
    signerKey,
    signature
  ]);
  const cells = mergeDocumentCells(bodyPlan.cells, signerKey.cells, signature.cells, signed.cells);
  return {
    protocol: DOCUMENT_HCV0_PROTOCOL,
    version: 1,
    type: kind,
    signer_key: signerKeyId || `ed25519:${signerKey.root}`,
    signer_key_root: `sha256:${signerKey.root}`,
    body,
    body_root: `sha256:${bodyPlan.root}`,
    root: `sha256:${signed.root}`,
    signature: bytesToBase64Url(signatureBytes),
    hcp1_pack: documentHcp1Pack(cells),
    hcv1_cells: cells.map(serializableCell)
  };
}

export async function signDocumentRecordWithSigner(kind, body, signer, signerKeyId = null) {
  const publicKeyBytes = signer.publicKeyBytes instanceof Uint8Array
    ? signer.publicKeyBytes
    : new Uint8Array(signer.publicKeyBytes || []);
  return assembleSignedRecord(kind, body, { ...signer, publicKeyBytes }, signerKeyId);
}

export async function signDocumentRecord(kind, body, key) {
  if (!key?.id || !key?.privateKey || (!key.publicKey && !key.publicJwk)) {
    throw new Error("a document signing key is required");
  }
  const publicKeyBytes = await rawEd25519PublicKey(key.publicKey ?? key.publicJwk);
  return assembleSignedRecord(kind, body, {
    publicKeyBytes,
    sign(payload) {
      return crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, payload);
    }
  }, key.id);
}

export async function verifyDocumentRecord(record, publicKeyOrJwk) {
  if (!record || record.protocol !== DOCUMENT_HCV0_PROTOCOL || record.version !== 1) {
    throw new Error("invalid HCV0 document record protocol");
  }
  const bodyPlan = await encodeDocumentRecordBody(record.type, record.body);
  if (record.body_root !== `sha256:${bodyPlan.root}`) throw new Error("HCV0 document body root mismatch");
  const signatureBytes = base64UrlToBytes(record.signature ?? "");
  const publicKey = publicKeyOrJwk?.type === "public"
    ? publicKeyOrJwk
    : await crypto.subtle.importKey("jwk", publicKeyOrJwk, { name: "Ed25519" }, true, ["verify"]);
  const publicBytes = await rawEd25519PublicKey(publicKey);
  const signerKey = await encodeDocumentValue(publicBytes);
  if (record.signer_key_root !== `sha256:${signerKey.root}`) throw new Error("HCV0 document signer root mismatch");
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    signatureBytes,
    documentSigningBytes(record.type, bodyPlan.root)
  );
  if (!valid) throw new Error("invalid GWDP0 document signature");
  const signature = await encodeDocumentValue(signatureBytes);
  const signed = await createRecordCell("document/signed-record", [
    { root: bodyPlan.root, cells: bodyPlan.cells },
    signerKey,
    signature
  ]);
  if (record.root !== `sha256:${signed.root}`) throw new Error("HCV0 document signed record root mismatch");
  const cells = mergeDocumentCells(bodyPlan.cells, signerKey.cells, signature.cells, signed.cells);
  if (record.hcp1_pack && record.hcp1_pack !== documentHcp1Pack(cells)) {
    throw new Error("HCP0 document record pack mismatch");
  }
  return record.body;
}
