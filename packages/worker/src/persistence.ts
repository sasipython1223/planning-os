import type { BaselineMap, Dependency, Task } from "protocol";

const DB_NAME = "PlannerStudioDB";
const STORE_NAME = "workspaces";
const SESSION_KEY = "active-session";
const CURRENT_SCHEMA_VERSION = 1;

export interface PersistedState {
  version: number;
  lastModified: number;
  state: {
    projectStartDate: string;
    excludeWeekends: boolean;
    tasks: Task[];
    dependencies: Dependency[];
    baselines: BaselineMap;
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPersistedState(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    return await new Promise<PersistedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => {
        const data = req.result as PersistedState | undefined;
        if (!data || typeof data.version !== "number") {
          resolve(null);
        } else if (data.version > CURRENT_SCHEMA_VERSION) {
          console.warn("[Persistence] Schema version", data.version, "is newer than supported", CURRENT_SCHEMA_VERSION);
          resolve(null);
        } else {
          resolve(data);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("[Persistence] Failed to load state:", err);
    return null;
  }
}

export async function savePersistedState(persisted: PersistedState): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(persisted, SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[Persistence] Failed to save state:", err);
  }
}
