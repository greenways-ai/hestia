import { chmod, readFile, writeFile } from "node:fs/promises";
import { createAgentProfile, generateAgentKey } from "../src/agent-protocol.js";

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2) throw new Error("invalid hex input");
  return Uint8Array.from(hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

async function createFixture(path) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    profileId: "profile:postgres-verification-fixture",
    name: "PostgreSQL Verification Fixture",
    rootKey,
    operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });

  const environment = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const environmentPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", environment.publicKey)
  );
  const environmentPrivateKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", environment.privateKey)
  );
  const packBytes = new TextEncoder().encode(profile.record.hcp1_pack);
  const fixture = {
    environment_id: "hestia-ci",
    environment_public_key_hex: bytesToHex(environmentPublicKey),
    environment_private_key_base64: Buffer.from(environmentPrivateKey).toString("base64"),
    signed_record_root_hex: profile.record.root.replace(/^sha256:/, ""),
    record_kind: profile.record.type,
    cell_count: profile.record.hcv1_cells.length,
    pack_hex: bytesToHex(packBytes)
  };
  environmentPrivateKey.fill(0);
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(path, 0o600);
}

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function signFixture(path, payloadHex) {
  const fixture = await readFixture(path);
  const privateBytes = new Uint8Array(
    Buffer.from(fixture.environment_private_key_base64, "base64")
  );
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateBytes,
      { name: "Ed25519" },
      false,
      ["sign"]
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      hexToBytes(payloadHex)
    ));
    process.stdout.write(bytesToHex(signature));
  } finally {
    privateBytes.fill(0);
  }
}

const [command, path, argument] = process.argv.slice(2);
if (command === "create" && path) {
  await createFixture(path);
} else if (command === "get" && path && argument) {
  const fixture = await readFixture(path);
  if (!(argument in fixture)) throw new Error(`unknown fixture field: ${argument}`);
  process.stdout.write(String(fixture[argument]));
} else if (command === "sign" && path && argument) {
  await signFixture(path, argument);
} else {
  throw new Error("usage: agent-record-fixture.mjs create FILE | get FILE FIELD | sign FILE PAYLOAD_HEX");
}
