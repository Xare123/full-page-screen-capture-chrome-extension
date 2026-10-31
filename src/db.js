let database;
function openDB() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("capture-studio", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects"))
          request.result.createObjectStore("projects", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("summaries")) {
          const summaries = request.result.createObjectStore("summaries", {
            keyPath: "id",
          });
          const cursor = request.transaction
            .objectStore("projects")
            .openCursor();
          cursor.onsuccess = () => {
            if (cursor.result) {
              summaries.put(summary(cursor.result.value));
              cursor.result.continue();
            }
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return database;
}
async function transaction(mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", mode);
    const request = callback(tx.objectStore("projects"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Local storage could not be updated."));
  });
}
export const getProject = (id) =>
  transaction("readonly", (store) => store.get(id));
function summary(project) {
  return {
    id: project.id,
    title: project.title,
    source: project.source,
    created: project.created,
    updated: project.updated,
    mode: project.mode,
    thumbnail: project.thumbnail,
    parts: project.images.length,
    width: project.images[0].width,
    height: project.images[0].height,
    bytes: project.images.reduce((total, image) => total + image.blob.size, 0),
  };
}
async function writeBoth(callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["projects", "summaries"], "readwrite");
    callback(tx.objectStore("projects"), tx.objectStore("summaries"));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Local storage could not be updated."));
  });
}
export const putProject = (project) =>
  writeBoth((projects, summaries) => {
    projects.put(project);
    summaries.put(summary(project));
  });
export class ProjectConflict extends Error {
  constructor(removed = false) {
    super(
      removed
        ? "This capture was deleted in another tab. Save a copy to keep these edits."
        : "This capture changed in another tab. Reopen the latest version or save a copy of your edits.",
    );
    this.name = "ProjectConflict";
    this.removed = removed;
  }
}
export async function updateProject(project, expectedRevision) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["projects", "summaries"], "readwrite");
    const projects = tx.objectStore("projects"),
      summaries = tx.objectStore("summaries");
    let conflict;
    const request = projects.get(project.id);
    request.onsuccess = () => {
      const existing = request.result;
      if (!existing || (existing.revision || 0) !== expectedRevision) {
        conflict = new ProjectConflict(!existing);
        tx.abort();
        return;
      }
      projects.put(project);
      summaries.put(summary(project));
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () =>
      reject(
        conflict ||
          tx.error ||
          new Error("Local storage could not be updated."),
      );
  });
}
export const deleteProject = (id) =>
  writeBoth((projects, summaries) => {
    projects.delete(id);
    summaries.delete(id);
  });
export async function listProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("summaries")
      .objectStore("summaries")
      .getAll();
    request.onsuccess = () =>
      resolve(request.result.sort((a, b) => b.updated - a.updated));
    request.onerror = () => reject(request.error);
  });
}
