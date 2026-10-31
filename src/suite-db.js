// Supporting notes and media have their own database; existing captures retain
// their original schema and identity when this extension is updated.
let opening;
export class SuiteConflict extends Error {
  constructor() {
    super(
      "This item changed in another studio tab. Reopen it before editing again.",
    );
    this.name = "SuiteConflict";
  }
}
export function openSuiteDB() {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("capture-studio-suite", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["notes", "recordings"])
          db.createObjectStore(name, { keyPath: "id" });
        const chunks = db.createObjectStore("chunks", {
          keyPath: ["recordingId", "index"],
        });
        chunks.createIndex("recording", "recordingId");
      };
      request.onerror = () => {
        opening = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    });
  return opening;
}
async function read(storeName, key, all = false) {
  const db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName),
      store = tx.objectStore(storeName);
    const request = all ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export const getSuiteItem = (kind, id) => read(kind, id);
export async function listSuiteItems(kind) {
  return (await read(kind, null, true)).sort((a, b) => b.updated - a.updated);
}
export async function putSuiteItem(
  kind,
  item,
  expectedRevision = item.revision || 0,
) {
  const db = await openSuiteDB(),
    copy = structuredClone(item);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(kind, "readwrite"),
      store = tx.objectStore(kind),
      request = store.get(copy.id);
    let error, result;
    request.onsuccess = () => {
      if ((request.result?.revision || 0) !== expectedRevision) {
        error = new SuiteConflict();
        tx.abort();
        return;
      }
      result = { ...copy, updated: Date.now(), revision: expectedRevision + 1 };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(
        error || tx.error || new Error("This item could not be saved locally."),
      );
  });
}
export async function patchSuiteItem(kind, id, patch) {
  const db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(kind, "readwrite"),
      store = tx.objectStore(kind),
      request = store.get(id);
    let result, error;
    request.onsuccess = () => {
      if (!request.result) {
        error = new Error("This item was removed.");
        tx.abort();
        return;
      }
      result = {
        ...request.result,
        ...patch,
        id,
        updated: Date.now(),
        revision: (request.result.revision || 0) + 1,
      };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(error || tx.error || new Error("The item could not be updated."));
  });
}
export async function deleteSuiteItem(kind, id) {
  const db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const stores = kind === "recordings" ? ["recordings", "chunks"] : [kind],
      tx = db.transaction(stores, "readwrite");
    tx.objectStore(kind).delete(id);
    if (kind === "recordings") {
      const request = tx
        .objectStore("chunks")
        .index("recording")
        .openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        if (request.result) {
          request.result.delete();
          request.result.continue();
        }
      };
    }
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("The item could not be removed."));
  });
}
export async function appendRecordingChunk(
  recordingId,
  session,
  index,
  blob,
  duration,
) {
  if (!(blob instanceof Blob) || !Number.isSafeInteger(index) || index < 0)
    throw new Error("Invalid recording chunk.");
  const db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["recordings", "chunks"], "readwrite"),
      store = tx.objectStore("recordings"),
      request = store.get(recordingId);
    let result, error;
    request.onsuccess = () => {
      const current = request.result;
      if (
        !current ||
        current.session !== session ||
        current.nextChunk !== index ||
        !["recording", "stopping"].includes(current.status)
      ) {
        error = new Error(
          "This recording session changed. Its existing chunks are safe.",
        );
        tx.abort();
        return;
      }
      tx.objectStore("chunks").add({ recordingId, index, blob });
      result = {
        ...current,
        nextChunk: index + 1,
        bytes: current.bytes + blob.size,
        duration,
        updated: Date.now(),
        revision: (current.revision || 0) + 1,
      };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(
        error ||
          tx.error ||
          new Error("Recording storage is full or unavailable."),
      );
  });
}
export async function recordingBlob(record) {
  const db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks"),
      request = tx
        .objectStore("chunks")
        .index("recording")
        .getAll(IDBKeyRange.only(record.id));
    request.onsuccess = () => {
      const chunks = request.result.sort((a, b) => a.index - b.index);
      if (
        chunks.length !== record.nextChunk ||
        chunks.some((c, i) => c.index !== i)
      ) {
        reject(new Error("The saved recording is incomplete."));
        return;
      }
      resolve(
        new Blob(
          chunks.map((c) => c.blob),
          { type: record.mime },
        ),
      );
    };
    request.onerror = () => reject(request.error);
  });
}
export async function importRecording(file) {
  const db = await openSuiteDB(),
    record = {
      id: crypto.randomUUID(),
      session: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, ""),
      originalName: file.name,
      created: Date.now(),
      updated: Date.now(),
      revision: 1,
      status: "complete",
      bytes: file.size,
      nextChunk: 1,
      duration: 0,
      mime: file.type || "video/webm",
      imported: true,
    };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["recordings", "chunks"], "readwrite");
    tx.objectStore("recordings").add(record);
    tx.objectStore("chunks").add({
      recordingId: record.id,
      index: 0,
      blob: file,
    });
    tx.oncomplete = () => resolve(record);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not save the imported video."));
  });
}
