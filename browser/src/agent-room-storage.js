const databaseName = "hestia-agent-rooms-v1";
const storeName = "workspaces";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, operation) {
  const db = await database();
  try {
    const transaction = db.transaction(storeName, mode);
    const result = await operation(transaction.objectStore(storeName));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export function emptyAgentRoomWorkspace(id = "default") {
  return {
    id,
    version: 2,
    events: [],
    activity: [],
    receipts: [],
    host: null,
    room: null,
    invite: null,
    guest: null,
    epoch: null,
    mandates: [],
    work: [],
    documents: [],
    messages: [],
    offers: [],
    acceptance: null,
    sharedReceipt: null,
    closure: null,
    keyRotations: [],
    program: null,
    updated_at: new Date().toISOString()
  };
}

function normalizeWorkspace(stored, id) {
  const empty = emptyAgentRoomWorkspace(id);
  if (!stored) return empty;
  return {
    ...empty,
    ...stored,
    version: 2,
    events: Array.isArray(stored.events) ? stored.events : [],
    activity: Array.isArray(stored.activity) ? stored.activity : [],
    receipts: Array.isArray(stored.receipts) ? stored.receipts : [],
    mandates: Array.isArray(stored.mandates) ? stored.mandates : [],
    work: Array.isArray(stored.work) ? stored.work : [],
    documents: Array.isArray(stored.documents) ? stored.documents : [],
    messages: Array.isArray(stored.messages) ? stored.messages : [],
    offers: Array.isArray(stored.offers) ? stored.offers : [],
    keyRotations: Array.isArray(stored.keyRotations) ? stored.keyRotations : []
  };
}

export async function loadAgentRoomWorkspace(id = "default") {
  const stored = await transact("readonly", (store) => requestResult(store.get(id)));
  return normalizeWorkspace(stored, id);
}

export async function saveAgentRoomWorkspace(workspace) {
  const stored = {
    ...normalizeWorkspace(workspace, workspace.id ?? "default"),
    version: 2,
    updated_at: new Date().toISOString()
  };
  await transact("readwrite", (store) => requestResult(store.put(stored)));
  return stored;
}

export async function clearAgentRoomWorkspace(id = "default") {
  await transact("readwrite", (store) => requestResult(store.delete(id)));
}
