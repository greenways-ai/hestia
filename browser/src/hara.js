import { HtaContext, HtaKeyword } from "/hara-runtime/index.js";

const resources = [
  ["std.crypto.shamir", "/hara/shamir.hal"],
  ["hestia.ceremony", "/hara/ceremony.hal"]
];

let runtimePromise;

export function requireWebCrypto() {
  if (!globalThis.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("Hestia requires HTTPS so browser cryptography is available");
  }
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is unavailable in this browser context");
  }
  return globalThis.crypto;
}

export function toHta(value) {
  if (value === undefined || value === null || typeof value !== "object") return value ?? null;
  if (value instanceof Uint8Array || value instanceof Map || Array.isArray(value)) {
    return Array.isArray(value) ? value.map(toHta) : value;
  }
  return new Map(Object.entries(value).map(([key, item]) => [key, toHta(item)]));
}

export function toPlain(value) {
  if (value instanceof HtaKeyword) return value.name;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Map) return Object.fromEntries(
    [...value].map(([key, item]) => [key instanceof HtaKeyword ? key.name : String(key), toPlain(item)])
  );
  return value;
}

async function loadRuntime() {
  const crypto = requireWebCrypto();
  const context = new HtaContext({
    worker: new Worker("/hara-runtime/worker.js", { type: "module", name: "hestia-hara-os" }),
    moduleUrl: "/hara-runtime/hara_wasm_raw.wasm",
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
  return context;
}

export function haraRuntime() {
  runtimePromise ??= loadRuntime().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export async function haraSession(name, requires) {
  const context = await haraRuntime();
  const session = await context.createSession(name);
  await session.eval(`(require ${requires})`);
  return session;
}
