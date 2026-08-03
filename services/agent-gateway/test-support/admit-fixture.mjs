import { readFile } from "node:fs/promises";
import { AGENT_HTTP_PROTOCOL } from "../src/protocol.mjs";

function hexToBase64Url(hex) {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid fixture hex value");
  }
  return Buffer.from(hex, "hex").toString("base64url");
}

async function fixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requestBody(data, prefix) {
  const root = data[`${prefix}_record_root_hex`];
  const kind = data[`${prefix}_record_kind`];
  const packHex = data[`${prefix}_pack_hex`];
  if (!root || !kind || !packHex) throw new Error(`missing fixture record: ${prefix}`);
  const body = {
    protocol: AGENT_HTTP_PROTOCOL,
    request_id: `request:${prefix}`,
    record: {
      root: `sha256:${root}`,
      kind,
      hcp1_pack: Buffer.from(packHex, "hex").toString("utf8")
    }
  };
  if (kind === "room/admission-proof") {
    body.capability = hexToBase64Url(data.capability_hex);
  }
  return body;
}

async function admit(endpoint, path, prefix, expectedStatus) {
  const data = await fixture(path);
  const request = requestBody(data, prefix);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const result = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${prefix} returned HTTP ${response.status}, expected ${expectedStatus}: ${JSON.stringify(result)}`
    );
  }
  if (expectedStatus === 200) {
    if (result.ok !== true
        || result.protocol !== AGENT_HTTP_PROTOCOL
        || result.request_id !== request.request_id
        || result.record_root !== request.record.root
        || result.record_kind !== request.record.kind) {
      throw new Error(`${prefix} returned an unbound success response`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(result.verification?.signed_receipt_root ?? "")
        || !/^sha256:[0-9a-f]{64}$/.test(result.admission?.signed_receipt_root ?? "")) {
      throw new Error(`${prefix} did not return canonical signed receipt roots`);
    }
    if (prefix === "proof" && result.admission.next_membership_epoch !== "2") {
      throw new Error("guest admission did not advance the room to epoch two");
    }
  } else if (result.ok !== false || result.error?.code !== "admission-rejected") {
    throw new Error(`${prefix} did not return a structured admission rejection`);
  }
  process.stdout.write(JSON.stringify(result));
}

const [command, endpoint, path, prefix, expected = "200"] = process.argv.slice(2);
if (command === "admit" && endpoint && path && prefix) {
  await admit(endpoint, path, prefix, Number(expected));
} else if (command === "request" && path && prefix) {
  process.stdout.write(JSON.stringify(requestBody(await fixture(path), prefix)));
} else {
  throw new Error(
    "usage: admit-fixture.mjs admit ENDPOINT FIXTURE PREFIX [STATUS] | request ignored FIXTURE PREFIX"
  );
}
