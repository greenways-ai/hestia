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
    version: 1,
    events: [],
    activity: [],
    host: null,
    room: null,
    invite: null,
    guest: null,
    epoch: null,
    documents: [],
    messages: [],
    offers: [],
    acceptance: null,
    updated_at: new Date().toISOString()
  };
}

export async function loadAgentRoomWorkspace(id = "default") {
  const stored = await transact("readonly", (store) => requestResult(store.get(id)));
  return stored ?? emptyAgentRoomWorkspace(id);
}

export async function saveAgentRoomWorkspace(workspace) {
  const stored = {
    ...workspace,
    version: 1,
    updated_at: new Date().toISOString()
  };
  await transact("readwrite", (store) => requestResult(store.put(stored)));
  return stored;
}

export async function clearAgentRoomWorkspace(id = "default") {
  await transact("readwrite", (store) => requestResult(store.delete(id)));
}
