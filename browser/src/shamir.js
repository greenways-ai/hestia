import { HtaContext } from "/hara-runtime/index.js";

const workerUrl = "/hara-runtime/worker.js";
const wasmUrl = "/hara-runtime/hara_wasm_raw.wasm";
const resources = [["std.crypto.shamir", "/hara/shamir.hal"]];

let runtimePromise;

function requireWebCrypto() {
  if (!globalThis.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("Hestia requires HTTPS so browser cryptography is available");
  }
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is unavailable in this browser context");
  }
  return globalThis.crypto;
}

async function loadRuntime() {
  const crypto = requireWebCrypto();
  const context = new HtaContext({
    worker: new Worker(workerUrl, { type: "module", name: "hestia-hara" }),
    moduleUrl: wasmUrl,
    hostCalls: {
      "crypto.random/fill": (length) => {
        if (!Number.isInteger(length) || length < 0 || length > 65_536) {
          throw new Error("Hara requested an invalid random byte count");
        }
        return crypto.getRandomValues(new Uint8Array(length));
      }
    }
  });
  const sources = await Promise.all(resources.map(async ([namespace, url]) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load Hara module ${namespace} (${response.status})`);
    return [namespace, await response.text()];
  }));
  await context.call("register-resources", [sources]);
  const session = await context.createSession("HESTIA");
  await session.eval("(require [std.crypto.shamir :as shamir])");
  return { context, session };
}

function runtime() {
  runtimePromise ??= loadRuntime().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export async function splitSecret(secret, { shares = 3, threshold = 2 } = {}) {
  const bytes = secret instanceof Uint8Array ? secret : new Uint8Array(secret);
  const { session } = await runtime();
  const entropyLength = await session.evalBound(
    "(shamir/entropy-byte-count __hta_arg_0 __hta_arg_1 __hta_arg_2)",
    [bytes, shares, threshold]
  );
  const coefficients = requireWebCrypto().getRandomValues(new Uint8Array(entropyLength));
  return session.evalBound(
    "(shamir/split-with-coefficients __hta_arg_0 __hta_arg_1 __hta_arg_2 __hta_arg_3)",
    [bytes, shares, threshold, coefficients]
  );
}

export async function combineShares(shares) {
  const values = shares.map((share) => share instanceof Uint8Array ? share : new Uint8Array(share));
  const { session } = await runtime();
  return session.evalBound("(shamir/combine __hta_arg_0)", [values]);
}

export async function haraRuntimeInfo() {
  const { session } = await runtime();
  return session.info();
}
