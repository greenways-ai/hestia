import { base64UrlToBytes, bytesToBase64Url, concatBytes, textEncoder } from "./encoding.js";
import { canonical, sha256 } from "./protocol.js";

const databaseName = "hestia-recovery-demo-v1";
const storeName = "ceremonies";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "ceremony" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact(mode, operation) {
  const db = await database();
  try {
    const tx = db.transaction(storeName, mode);
    const result = await operation(tx.objectStore(storeName));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function loadCeremony(ceremony) {
  return transact("readonly", (store) => requestResult(store.get(ceremony)));
}

export function saveCeremony(record) {
  return transact("readwrite", (store) => requestResult(store.put(record)));
}

export async function createWrappingKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function protectShare(share, wrappingKey, ceremony) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: textEncoder.encode(ceremony), tagLength: 128
  }, wrappingKey, share));
  return { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext) };
}

export async function openProtectedShare(protectedShare, wrappingKey, ceremony) {
  return new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64UrlToBytes(protectedShare.iv),
    additionalData: textEncoder.encode(ceremony),
    tagLength: 128
  }, wrappingKey, base64UrlToBytes(protectedShare.ciphertext)));
}

export async function appendTranscript(record, type, details = {}) {
  const previous = record.transcript_head
    ? base64UrlToBytes(record.transcript_head)
    : new Uint8Array(32);
  const event = {
    sequence: (record.transcript?.length ?? 0) + 1,
    type,
    at: new Date().toISOString(),
    details
  };
  const hash = await sha256(concatBytes(previous, textEncoder.encode(canonical(event))));
  record.transcript = [...(record.transcript ?? []), { ...event, hash: bytesToBase64Url(hash) }];
  record.transcript_head = bytesToBase64Url(hash);
  return event;
}
